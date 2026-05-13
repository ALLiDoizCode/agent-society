# Story 47.3: Hourly Earnings Snapshot Writer

Status: done

> **Third story of Epic 47 (Earnings Data Plane) — the time-series machinery that turns the cumulative `claimsReceivedTotal` numbers the connector already ships into the TODAY / MONTH / YEAR deltas the dashboard renders.** Sized M. Depends on Story 47.1 (`done`) for `ConnectorAdminClient.getEarnings()` + `EarningsResponse`. Depends on Story 47.2 (`done`) for the `DeltaComputer` type contract (the function shape this story implements) and the `AggregateEarningsInput.deltaComputer` injection point this story plugs into. Blocks 47.4 (the host-API route wires the `DeltaComputer` produced here into the aggregator call site) and 47.5 (live gate asserts a snapshot line is on disk). Introduces two new files (`snapshot-writer.ts`, `snapshot-reader.ts`) under `packages/townhouse/src/earnings/`, adds the **first** `fast-check`-powered test suite in the package (the property-based DST / year-boundary / corruption tests AC #5 mandates), and wires a `SnapshotWriter` background tick into `createApiServer` alongside `TransportProbe` so it stops cleanly on `townhouse hs down`. The connector v3.3.3+ earnings contract is consumed unchanged; no connector pin bump, no migration-doc entry beyond the per-package CHANGELOG-equivalent note in this story's Review Findings. **The dev MUST read "Time, Tick Cadence & Boundary Math" and "Mid-Write Truncation Recovery" in Dev Notes before drafting — those decisions shape the size of the test suite.**

## Story

As a **townhouse host API**,
I want to persist hourly snapshots of cumulative connector earnings,
So that the dashboard can compute TODAY / MONTH / YEAR / LIFETIME deltas without asking the connector team to add windowed endpoints.

## Acceptance Criteria

1. **Given** the snapshot writer at `packages/townhouse/src/earnings/snapshot-writer.ts`
   **When** the apex process is running (`townhouse hs up` → `townhouse-api` container booted)
   **Then** a `SnapshotWriter` instance is constructed inside `createApiServer` and its background tick is started **And** the tick is cleared in `apiServer.close()` so `townhouse hs down` (container SIGTERM → `apiServer.close()`) leaves no dangling timer.

2. **Given** an hourly tick fires
   **When** the writer executes
   **Then** it calls `connectorAdmin.getEarnings()` AND appends **one JSON-per-line entry per (peer × asset) pair AND one entry per apex `connectorFees[]` row** to `${dirname(configPath)}/earnings-snapshots.jsonl`
   **And** each entry has the exact shape `{ts: string, peerId: string, assetCode: string, claimsReceivedTotal: string}` — `ts` is the ISO-8601 UTC tick boundary, `peerId` is the connector peerId (or the literal `'__apex__'` for apex routing-fee rows), `assetCode` matches the connector value verbatim, `claimsReceivedTotal` is the connector's decimal-string cumulative.
   > **Spec note:** the epic spec at line 896 says "for each peer × asset" — apex routing fees are not in the connector's `peers[]`, they live in `connectorFees[]`. This story extends the spec by writing apex rows under `peerId: '__apex__'` so the same JSONL feeds both the apex `DeltaComputer` call (`scope: '__apex__'`) and the per-peer calls (47.2 aggregator path). See Open Question 1.

3. **Given** the snapshot reader at `packages/townhouse/src/earnings/snapshot-reader.ts`
   **When** the dashboard requests TODAY / MONTH / YEAR via the `DeltaComputer` function this story exports
   **Then** the values are computed as:
   - `TODAY = current_lifetime − snapshot_at(most_recent_UTC_midnight_≤_now)`
   - `MONTH = current_lifetime − snapshot_at(most_recent_UTC_month_boundary_≤_now)` (month boundary = first instant of the current calendar month in UTC, e.g. `2026-05-01T00:00:00.000Z`)
   - `YEAR  = current_lifetime − snapshot_at(most_recent_UTC_year_boundary_≤_now)` (year boundary = `YYYY-01-01T00:00:00.000Z`)
   - `LIFETIME` is reported by the aggregator directly from the connector; **the snapshot reader does NOT compute LIFETIME** (it's the 47.2 `PerAsset.lifetime` field, copied straight from `claimsReceivedTotal`).
   **And** when no boundary snapshot exists yet (e.g. first hour after `townhouse hs up`), the delta defaults to `'0'` — never undefined, never NaN, never a negative bigint.
   **And** decimal-string subtraction is performed via `BigInt` to preserve precision for any `assetScale` (USD: 6, ETH: 18, sats: 0).

4. **Given** snapshot retention
   **When** the pruner runs (same hourly tick, executed AFTER the append)
   **Then** entries with `ts < (now − 13 months)` are purged from the JSONL file via a single atomic rewrite (read → filter → write to `<path>.tmp` → `rename`)
   **And** the file mode after rewrite is `0o600` (re-`chmod` after `rename` because `writeFile` honors `mode` only on creation — see `state/nodes-yaml.ts:106-110` for the established pattern).

5. **Given** property-based tests via `fast-check` at `packages/townhouse/src/earnings/snapshot-reader.property.test.ts`
   **When** the test suite runs
   **Then** for arbitrary claim sequences across **(a) DST transitions** (US spring-forward 2026-03-08, EU spring-forward 2026-03-29), **(b) year boundaries** (2026-12-31T23:59:59Z → 2027-01-01T00:00:00Z), **(c) month boundaries** (2026-04-30 → 2026-05-01), **(d) mid-write corruption** (truncated final line, BOM-prefixed line, line with embedded `\n`), and **(e) clock skew** (snapshot `ts` later than `now`), the following invariants hold:
   - **Monotonicity:** `claimsReceivedTotal` is non-decreasing across consecutive snapshots for the same `(peerId, assetCode)`. If a generated sequence violates this (the property generator should NOT generate decreases — claims-received is cumulative), the property test rejects via `fc.pre()`.
   - **Sum-of-deltas:** `TODAY + (lifetime_at_today_boundary − lifetime_at_month_boundary) = MONTH`, and similarly `MONTH + (...) = YEAR`. Equivalently: deltas computed against nested boundaries telescope into the cumulative delta.
   - **No-crash:** the reader returns valid `{today, month, year}` strings (no throws, no NaN) for every generated input including corruption fixtures.

6. **Given** a 9500-entry fixture (13 months × hourly × ~1 (peer×asset) row per hour — fixture generator lives in the test file, NOT checked into git as a static blob)
   **When** the reader processes a single `DeltaComputer` call
   **Then** the call completes in **<100ms wall-clock on the CI baseline runner** (vitest's default `expect(...).toBeLessThan(100)` against `performance.now()` deltas) AND the on-disk JSONL fixture size is **<2MB** (asserted via `statSync(fixturePath).size < 2 * 1024 * 1024`).
   > **Note:** 9500 entries × ~150 bytes/line ≈ 1.4MB. Real production load (≤3 peers × ≤3 assets × 9500 hours ≈ 86k lines) is bigger; the 9500 number is the spec's lower bound and matches a single-(peer,asset) row at 13-month retention. If the reader's perf doesn't generalize to the 86k case, document it and let 47.5 (live gate) escalate. v1 fleet is single-Town-single-USDC anyway.

7. **Given** mid-write truncation
   **When** the writer is killed mid-append (simulated in tests by writing `…incomplete-without-newline`)
   **Then** the next reader pass / next writer pass skips the malformed trailing line **without** crashing
   **And** the next writer append starts with a leading `\n` IFF the file does not end in `\n` — preserving JSONL invariants AND avoiding double-blank lines (the partial line is left in place; the reader's "skip non-parseable" semantics make it cheap).
   > **Spec wording from epic AC:** "the next boot reads to the last well-formed JSONL line without crashing AND resumes appending." This story reads that as: **don't repair the file on read — repair on the NEXT write** (lazy compaction). See "Mid-Write Truncation Recovery" in Dev Notes.

8. **Given** the snapshot file is created (first append from a fresh `~/.townhouse/`)
   **When** the file mode is checked
   **Then** mode is `0o600` (consistent with `nodes.yaml`, `host.json`, `connector.yaml`, `reconciler.log` — operator-secret per NFR8).

9. **Given** the writer is wired into `createApiServer`
   **When** the route layer (47.4) needs a `DeltaComputer`
   **Then** this story exports a `createDeltaComputer({ snapshotPath, now? }): DeltaComputer` factory that satisfies the 47.2 `DeltaComputer` type signature — no wrapping, no shim, no munging in 47.4.

**FRs:** FR16 (hourly snapshots → deltas). **NFRs:** NFR4 (<100ms read), NFR8 (`0o600`), NFR11 (truncation recovery), NFR12 (13-month retention).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/earnings/aggregator.ts` end-to-end (~210 lines). Confirm the `DeltaComputer` type signature: `(params: { scope: string; assetCode: string; currentLifetime: string }) => Promise<{ today: string; month: string; year: string }>`. The factory you build in Task 4 returns a function of exactly this shape. Confirm the `'__apex__'` sentinel is what the aggregator uses for `connectorFees[]` rows — this story writes snapshot rows with `peerId: '__apex__'` so the reader's lookup matches the aggregator's scope arg without any name mapping.
  - [x] 1.2 Read `packages/townhouse/src/api/server.ts` end-to-end (91 lines). The snapshot writer is constructed here, alongside `transportProbe`, and stopped in `close()`. Existing pattern to mirror: `transportProbe.stop()` inside `close()` wrapped in a best-effort try/catch. Add a `snapshotWriter.stop()` call ABOVE the `app.close()` race — the writer's stop is synchronous (`clearInterval`), so ordering with the WebSocket teardown doesn't matter, but stopping it first guards against the writer firing a final tick after Fastify has begun shutting down.
  - [x] 1.3 Read `packages/townhouse/src/api/types.ts:411-423` (the `ApiDeps` interface). **Do NOT add `snapshotWriter` to `ApiDeps`** — the writer is owned by `createApiServer` itself, not injected. The factory pattern matches `transportProbe`'s historic shape before it was promoted to `ApiDeps` (the promotion happened because callers needed to share an instance across two server factories; this story has only one server factory, so keep it owned). Open Question 4 if the dev wants to inject anyway.
  - [x] 1.4 Read `packages/townhouse/src/state/nodes-yaml.ts` end-to-end (116 lines). This is the canonical file-IO pattern for operator-secret state in townhouse: atomic write via `<path>.tmp` + `fs.rename`, post-rename `fs.chmod(path, 0o600)`, ENOENT-graceful read, `mkdir(dir, { recursive: true, mode: 0o700 })`. The snapshot writer's atomic-rewrite (pruning path) MUST follow this convention. The append path (hourly tick) uses `fs.appendFile(path, line, { mode: 0o600 })` + one-shot `fs.chmod(path, 0o600)` — see `reconciler.ts:189-209` for the precedent.
  - [x] 1.5 Read `packages/townhouse/src/reconciler.ts:179-210` (the `appendLog` JSONL pattern). This is the existing append-to-JSONL precedent in townhouse — the snapshot writer's per-tick append path should mirror it: build `JSON.stringify(entry) + '\n'`, ensure the dir exists once, `fs.appendFile` with `mode: 0o600`, one-shot post-create chmod. **One deviation:** the reconciler appends a SINGLE line per call; the snapshot writer appends N lines per tick (one per peer × asset + one per apex fee). Either (a) loop and call `appendFile` N times — clean but N syscalls per hour, or (b) build one multi-line string and call `appendFile` once. Recommendation: (b) — one syscall, atomic on Linux up to PIPE_BUF (4096 bytes) which covers ≤25 entries at ~150 bytes each, well above v1 scale of ≤9 entries (3 peers × 3 assets + 1 apex). See Open Question 2.
  - [x] 1.6 Read `packages/townhouse/src/connector/types.ts:223-323` — the `EarningsResponse` / `PeerEarnings` / `AssetEarnings` / `ConnectorFeeEntry` shapes. Confirm: `peers[*].peerId: string`, `peers[*].byAsset[*].claimsReceivedTotal: string` (decimal-string bigint), `peers[*].byAsset[*].assetCode: string`, `connectorFees[*].assetCode: string`, `connectorFees[*].total: string`. **The snapshot tracks `claimsReceivedTotal` per peer-asset AND `total` per apex-asset.** The snapshot's `claimsReceivedTotal` field name is misleading for apex rows (those are routing fees, not received claims) but is kept uniform so the JSONL has a single column shape — the consumer interprets it correctly via `peerId === '__apex__'`. See Open Question 1.
  - [x] 1.7 Read `docker/src/entrypoint-townhouse-api.ts` end-to-end (147 lines). Confirm: `createApiServer(deps)` is called once at container start; `apiServer.app.close()` runs on SIGINT/SIGTERM via `shutdown()`. This is the lifecycle hook the snapshot writer rides on — its `stop()` is invoked transitively through `apiServer.close()`. **No changes to this file** for this story (it's a thin wrapper).
  - [x] 1.8 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:882-925` (Story 47.3 spec + Story 47.4 spec). Confirm: 47.4 wires the `DeltaComputer` factory you build here into the route via `aggregateEarnings({ ..., deltaComputer: createDeltaComputer({ snapshotPath }) })`. 47.4 also extends the response with `recentClaims`, `eventsRelayed`, `uptimeSeconds`, and a per-peer `lastClaimAt` field — **none of those are this story's surface.** Stay narrow.
  - [x] 1.9 Read `packages/townhouse/compose/townhouse-hs.yml:177-185` (the `${TOWNHOUSE_HOME}:/.townhouse:rw` bind mount). Confirm the snapshot file lives at the host-side `~/.townhouse/earnings-snapshots.jsonl` AND container-side `/.townhouse/earnings-snapshots.jsonl` — both paths derive from `dirname(configPath)` (the API server's `configPath` is `/.townhouse/config.yaml` inside the container; `~/.townhouse/config.yaml` on the host). **No compose changes needed** — the bind mount already covers the new file.

- [x] **Task 2: Verify pre-conditions (AC: all)**
  - [x] 2.1 Confirm `47-2-aggregator-earnings-surgery: done` in `sprint-status.yaml` AND `DeltaComputer` is exported from `packages/townhouse/src/earnings/aggregator.ts` (it is — see line ~70). If absent → STOP, 47.2 is the dependency.
  - [x] 2.2 Confirm `47-1-sdk-get-earnings-wrap-and-contract-canary: done` AND `ConnectorAdminClient.getEarnings()` exists at `packages/townhouse/src/connector/admin-client.ts:240`. If absent → STOP, 47.1 is the dependency.
  - [x] 2.3 Confirm `pnpm --filter @toon-protocol/townhouse build` is clean on `epic-47` branch before starting (no pre-existing typecheck errors carried over from 47.2's 23-patch landing).
  - [x] 2.4 Capture baseline: `pnpm --filter @toon-protocol/townhouse test` test count (currently 965 across 62 files after 47.2; this story adds ~15–25 new tests across two new test files — `snapshot-writer.test.ts` and `snapshot-reader.property.test.ts` — net positive). Note `pnpm --filter @toon-protocol/townhouse test contract-canary` should still be 43 tests sub-500ms (unchanged).
  - [x] 2.5 **Add `fast-check` to townhouse devDependencies.** This is the first use of fast-check in the package (and in the repo — `grep -rn "fast-check" packages/` returns no production matches). Pin version `^3.21.0` (latest stable as of 2026-05-12; check `npm view fast-check version` if drift is suspected). Run `pnpm --filter @toon-protocol/townhouse install` after editing `package.json`. **Do NOT add fast-check to `dependencies`** — it's a test-only library. Add the version to a single `devDependencies` entry; do not hoist to the workspace root unless you've checked with Jonathan first.

- [x] **Task 3: Build `snapshot-writer.ts` (AC: 1, 2, 4, 7, 8)**
  - [x] 3.1 Create `packages/townhouse/src/earnings/snapshot-writer.ts`. Anchor module-level JSDoc: "Hourly earnings snapshot writer (Story 47.3). Persists `claimsReceivedTotal` per (peerId × assetCode) — plus apex `connectorFees[]` rows under `peerId: '__apex__'` — to `${dirname(configPath)}/earnings-snapshots.jsonl` once per hour. Consumed by `snapshot-reader.ts`'s `DeltaComputer` factory. Failure mode: any per-tick error is logged via `logger.warn` and swallowed (the writer NEVER throws into the apex event loop) — the next tick retries cleanly. Pruning runs after each successful append (entries older than 13 months are rewritten atomically). File mode is `0o600` on every write."
  - [x] 3.2 Declare the on-disk row type and exports:
    ```typescript
    /** One JSONL row in `earnings-snapshots.jsonl`. */
    export interface SnapshotEntry {
      /** ISO-8601 UTC timestamp of the tick boundary (e.g. '2026-05-12T15:00:00.000Z'). */
      ts: string;
      /** Connector peerId, OR the literal `'__apex__'` for apex routing-fee rows. */
      peerId: string;
      assetCode: string;
      /** Decimal-string cumulative (claims received for peers, routing-fee total for apex). */
      claimsReceivedTotal: string;
    }

    export interface SnapshotWriterOptions {
      connectorAdmin: ConnectorAdminClient;
      /** Absolute path to `earnings-snapshots.jsonl`. Caller responsibility — typically `${dirname(deps.configPath)}/earnings-snapshots.jsonl`. */
      snapshotPath: string;
      /** Optional: tick interval (ms). Default 3_600_000 (1 hour). Tests pass a small value (e.g. 50) and `vi.useFakeTimers()`. */
      tickIntervalMs?: number;
      /** Optional: injected clock for tests. Default `() => new Date()`. */
      now?: () => Date;
      /** Optional: retention window in months. Default 13. */
      retentionMonths?: number;
      /** Optional pino/Fastify-compatible logger; warn-only is enough. */
      logger?: { warn(obj: object, msg?: string): void };
      /**
       * Optional: fire one tick immediately on `start()` instead of waiting for
       * the first interval. Default `false` (production behavior — the apex
       * may boot mid-hour; the first natural tick captures stable state).
       * Tests set this to `true` to assert append behavior in <50ms.
       */
      fireOnStart?: boolean;
    }
    ```
    Re-export `SnapshotEntry` and `SnapshotWriterOptions` from `packages/townhouse/src/index.ts` (Task 7.2).
  - [x] 3.3 Implement the class:
    ```typescript
    export class SnapshotWriter {
      private timer: ReturnType<typeof setInterval> | null = null;
      private tickPending = false;  // re-entrancy guard (same pattern as metrics-ws.ts:205)

      constructor(private readonly opts: SnapshotWriterOptions) {}

      start(): void { /* set up the interval; if fireOnStart, void this.tick() */ }
      stop(): void  { /* clearInterval; null the handle; idempotent */ }
      /** exposed for test ergonomics (await one tick deterministically without faking timers) */
      async tick(): Promise<void> { /* one full append+prune cycle */ }
    }
    ```
  - [x] 3.4 Implement `tick()`:
    - Re-entrancy guard: if `this.tickPending` → return (skip). Set true; `try { … } finally { this.tickPending = false; }`.
    - Call `await this.opts.connectorAdmin.getEarnings()`. On throw (network, 503, shape drift), `logger.warn({ err }, 'snapshot writer: getEarnings failed — skipping this tick')` and return. **Never propagate the throw** — same philosophy as the aggregator's catch (47.2).
    - Compute the tick boundary `ts`: use `this.opts.now()` floored to the hour in UTC: `new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString()`. Floor-to-hour ensures DST jumps and minute-level clock skew don't produce duplicate or near-duplicate `ts` values across consecutive ticks. See "Time, Tick Cadence & Boundary Math" in Dev Notes.
    - Build the line buffer: for each `peer` in `earnings.peers`, for each `a` in `peer.byAsset`, emit one `SnapshotEntry`. Then for each `fee` in `earnings.connectorFees`, emit one `SnapshotEntry` with `peerId: '__apex__'` and `claimsReceivedTotal: fee.total`. Concatenate as `lines.map(JSON.stringify).join('\n') + '\n'`.
    - Append: `await this.appendAtomic(lines)`. Implementation: `await fs.mkdir(dirname(this.opts.snapshotPath), { recursive: true, mode: 0o700 })`; `await fs.appendFile(this.opts.snapshotPath, body, { encoding: 'utf-8', mode: 0o600 })`; one-shot post-create `await fs.chmod(this.opts.snapshotPath, 0o600)` guarded by a `private appendChmodEnsured = false` flag (mirrors `reconciler.ts:202-208`). **Cap a single `appendFile` call at PIPE_BUF (4096 bytes) for POSIX atomicity** — if the build buffer exceeds 4096 bytes, split into multiple `appendFile` calls. The v1 ceiling of ≤9 entries × ~150 bytes ≈ 1.4KB is comfortably under, but the split logic is cheap and forward-compatible. See Open Question 2.
    - Prune: call `await this.pruneIfNeeded()`. Skip pruning if the file size (`fs.stat`) is below a watermark (e.g. 256KB ≈ 1700 entries — well below the 13-month × ≤9 entries/hour ceiling); only do the full read-filter-rewrite when the file exceeds the watermark. Reason: pruning is expensive (read whole file → parse each line → write back) and unnecessary until retention actually bites. See Open Question 3.
  - [x] 3.5 Implement `pruneIfNeeded()`:
    - `const cutoff = new Date(now); cutoff.setUTCMonth(cutoff.getUTCMonth() - this.opts.retentionMonths ?? 13); const cutoffMs = cutoff.getTime();`
    - Read file via `fs.readFile(path, 'utf-8')`; split on `'\n'`; filter out empty lines; for each line: try `JSON.parse(line)`; if parse fails OR result is not a valid `SnapshotEntry` shape (defensive: `typeof entry.ts === 'string'` etc.) → DROP the line; if parse succeeds: keep IFF `new Date(entry.ts).getTime() >= cutoffMs`.
    - If kept-count == original-count AND no malformed lines → no rewrite needed; return. (Avoids spurious file churn.)
    - Else: write to `<path>.tmp` with `mode: 0o600`, then `fs.rename(<path>.tmp, <path>)`, then `fs.chmod(path, 0o600)` (re-chmod after rename — same idiom as `nodes-yaml.ts:106-110`).
    - Pruning takes the malformed-line opportunity to repair the file — after pruning, the JSONL is guaranteed well-formed. This is the "lazy compaction" referred to in AC #7.
  - [x] 3.6 Add explicit module-level JSDoc on every exported symbol, especially `SnapshotEntry.claimsReceivedTotal`'s "apex routing fees masquerade under this column" surprise.

- [x] **Task 4: Build `snapshot-reader.ts` and the `createDeltaComputer` factory (AC: 3, 5, 6, 9)**
  - [x] 4.1 Create `packages/townhouse/src/earnings/snapshot-reader.ts`. Module JSDoc: "Snapshot reader + `DeltaComputer` factory (Story 47.3). Reads `earnings-snapshots.jsonl` and computes TODAY/MONTH/YEAR deltas vs. UTC boundaries (midnight, 1st-of-month, 1st-of-year). Tolerates malformed lines (skip) and clock-skewed snapshots (filter `ts > now`). Returns `'0'` when no boundary snapshot exists yet."
  - [x] 4.2 Implement the boundary helpers (pure functions; unit-tested):
    ```typescript
    /** ISO of the most recent UTC midnight <= ref. */
    export function utcDayBoundary(ref: Date): string { /* set hours/min/sec/ms to 0 in UTC */ }
    /** ISO of the first instant of the current calendar month in UTC. */
    export function utcMonthBoundary(ref: Date): string { /* + setUTCDate(1) */ }
    /** ISO of the first instant of the current calendar year in UTC. */
    export function utcYearBoundary(ref: Date): string { /* + setUTCMonth(0) */ }
    ```
    **Why UTC** (not local time): DST does NOT apply to UTC, so "today" in the dashboard is UTC-anchored — Drew in Sydney and Drew in Berlin see the same TODAY value. This is a known v1 simplification; the dashboard's "your time zone" UX work is out-of-scope (likely Epic 48's UX-DR1). See Open Question 5.
  - [x] 4.3 Implement the snapshot lookup:
    ```typescript
    /**
     * Read snapshots from disk and find the row with the latest `ts <= boundary`
     * for the (scope, assetCode) tuple. Returns `null` if no such row exists.
     * Tolerates malformed lines (skip-on-parse-error).
     */
    async function findSnapshotAt(
      snapshotPath: string,
      scope: string,
      assetCode: string,
      boundaryIso: string
    ): Promise<SnapshotEntry | null> { /* ... */ }
    ```
    **Performance: stream-read the file line-by-line via Node's `readline` over `fs.createReadStream` — DO NOT `fs.readFile` and split on `\n`.** With 9500 entries × ~150 bytes = ~1.4MB, `readFile` is fine; with 86k entries (full fleet), the split allocates ~13MB of JS strings, and per-call cost on every dashboard poll (5s metrics-ws cadence) compounds fast. The reader's loop terminates on the first row beyond `boundaryIso` that's earlier than the current best match — or simpler: scan all lines (linear pass), filter by `(peerId, assetCode)`, sort by `ts` desc, take first `ts <= boundary`. The 100ms NFR is generous; pick the simpler implementation and measure. See Open Question 6.
  - [x] 4.4 Build the factory:
    ```typescript
    /**
     * Construct a `DeltaComputer` (Story 47.2's type) backed by the snapshot
     * file at `snapshotPath`. The returned function is the one wired into
     * `aggregateEarnings({ ..., deltaComputer })` by Story 47.4's route.
     */
    export function createDeltaComputer(opts: {
      snapshotPath: string;
      /** Optional clock injection for tests. Default `() => new Date()`. */
      now?: () => Date;
    }): DeltaComputer {
      return async ({ scope, assetCode, currentLifetime }) => {
        const ref = (opts.now ?? (() => new Date()))();
        const dayBoundary   = utcDayBoundary(ref);
        const monthBoundary = utcMonthBoundary(ref);
        const yearBoundary  = utcYearBoundary(ref);
        const [daySnap, monthSnap, yearSnap] = await Promise.all([
          findSnapshotAt(opts.snapshotPath, scope, assetCode, dayBoundary),
          findSnapshotAt(opts.snapshotPath, scope, assetCode, monthBoundary),
          findSnapshotAt(opts.snapshotPath, scope, assetCode, yearBoundary),
        ]);
        const cur = BigInt(currentLifetime);
        const subOrZero = (snap: SnapshotEntry | null): string => {
          if (!snap) return '0';
          try {
            const diff = cur - BigInt(snap.claimsReceivedTotal);
            return diff < 0n ? '0' : diff.toString();   // clamp clock-skew negatives
          } catch {
            return '0';  // unparseable bigint string → conservative '0'
          }
        };
        return {
          today: subOrZero(daySnap),
          month: subOrZero(monthSnap),
          year:  subOrZero(yearSnap),
        };
      };
    }
    ```
  - [x] 4.5 Single-pass optimization (perf): the three boundary lookups read the same file three times. For NFR4 compliance at 86k entries, batch them: read the file ONCE per `DeltaComputer` call, build a single `Map<{peerId,assetCode}, sortedEntries>` per call, then in-memory binary-search per boundary. The factory still returns a `DeltaComputer` but caches the parsed snapshot for the duration of the call (NOT across calls — see Open Question 6 for cross-call caching, deferred). For 9500 entries this matters; for 86k it's mandatory. **Recommendation:** implement single-read first (correctness + simplicity); add the in-call cache only if the 9500-entry perf test fails.
  - [x] 4.6 Export `createDeltaComputer`, `utcDayBoundary`, `utcMonthBoundary`, `utcYearBoundary`, and the `SnapshotEntry` type re-export from `packages/townhouse/src/index.ts` (Task 7.2).

- [x] **Task 5: Wire the writer into `createApiServer` (AC: 1)**
  - [x] 5.1 Edit `packages/townhouse/src/api/server.ts`. Construct `SnapshotWriter` near the top (after `buildFastifyApp`, before route registration). Path resolution: `const snapshotPath = join(dirname(deps.configPath), 'earnings-snapshots.jsonl');` — same pattern as the route layer's `nodes.yaml` resolution.
  - [x] 5.2 Pass `deps.connectorAdmin`, `snapshotPath`, and `logger: app.log` (Fastify's pino instance) into the writer. Do NOT set `fireOnStart` — production waits for the first natural tick.
  - [x] 5.3 Call `snapshotWriter.start()` after `await app.ready()` (if you add it; otherwise after the route registrations — they don't depend on it).
  - [x] 5.4 In `close()`: call `snapshotWriter.stop()` BEFORE the transportProbe stop. Wrap in best-effort try/catch (the writer's stop is just `clearInterval`, so it shouldn't throw — but match the existing style).
  - [x] 5.5 **Do NOT add `snapshotWriter` to `ApiDeps`.** The route (47.4) reads the snapshot via its own `createDeltaComputer({ snapshotPath })` call — the writer and the reader are decoupled via the file. 47.4 wires the reader into the aggregator; this story wires the writer into the server.

- [x] **Task 6: Unit tests — `snapshot-writer.test.ts` and `snapshot-reader.test.ts` (AC: 1, 2, 4, 6, 7, 8, 9)**
  - [x] 6.1 Create `packages/townhouse/src/earnings/snapshot-writer.test.ts`. Tests use `vi.useFakeTimers()` + injected `now` for deterministic tick boundaries. Build test doubles: `makeConnector(earnings: EarningsResponse | 'throw' | '503')` (same pattern as `aggregator.test.ts` from 47.2 — reuse if exporting it isn't too invasive).
  - [x] 6.2 Write the following test cases:
    1. **Append on tick** — Connector returns 2 peers × 1 asset each + 1 apex fee. `writer.start({ fireOnStart: true })`. After `await Promise.resolve()` (microtask drain) → file exists at expected path with 3 JSONL lines (1 apex + 2 peer rows), each shape `{ ts, peerId, assetCode, claimsReceivedTotal }`. Mode is `0o600` (assert via `statSync(path).mode & 0o777`).
    2. **Apex row uses `peerId: '__apex__'`** — Single-fee fixture asserts the literal sentinel.
    3. **`ts` is floored to the hour** — Inject `now = () => new Date('2026-05-12T15:42:37.000Z')`. Assert all 3 emitted `ts` values are exactly `'2026-05-12T15:00:00.000Z'`.
    4. **Re-entrancy guard** — First tick is in-flight (long-running getEarnings via a stalled promise); fire a second tick immediately → second tick is skipped (no second append, no second `getEarnings` call). After first tick resolves, fire a third → third runs normally.
    5. **`getEarnings` throws → tick is a no-op** — Connector throws `Error('connector down')`. After tick, file does NOT exist (or, if it pre-existed, is unchanged). `logger.warn` was called once with `{ err: ... }`.
    6. **Multiple ticks accumulate** — Drive 3 ticks with different `now` values. File has 3 sets of entries; each entry's `ts` matches its tick boundary. No duplicate timestamps (because the connector data may not change but the `ts` does).
    7. **Pruning: entries older than 13 months are removed** — Pre-seed the file with 100 entries spanning 14 months. Inject `now = 2026-05-12T15:00Z`. After a tick: file contains only entries with `ts >= 2025-04-12T15:00Z` (the cutoff) — assert via line count + parse.
    8. **Pruning watermark: small files are not rewritten** — Pre-seed with 10 entries (≪ watermark). Stat the file → record mtime. Tick → mtime UNCHANGED (no atomic rewrite happened). Asserts the watermark short-circuit.
    9. **Malformed line is pruned on next prune** — Pre-seed with: line1 (valid old), line2 (corrupt `not-json`), line3 (valid recent). Pre-seed enough entries to cross the watermark. Tick → prune runs → file contains line3 + the new tick's appends; line2 is gone.
    10. **Append batch is split if > PIPE_BUF** — Fabricate a fixture with enough fees + peers to push the build buffer past 4096 bytes. Spy on `fs.appendFile` → assert called ≥2 times for one tick. (If the dev opts for "single call regardless of size" per Open Question 2, this test becomes `assert called === 1`.)
    11. **`stop()` clears the timer; subsequent ticks do not fire** — Start writer with `tickIntervalMs: 50`. Advance fake timer 200ms; assert ≥3 ticks fired. Call `stop()`. Advance another 500ms; assert NO further ticks. Call `stop()` again — no throw (idempotent).
  - [x] 6.3 Create `packages/townhouse/src/earnings/snapshot-reader.test.ts`. Tests for the boundary helpers, the lookup function, and the `DeltaComputer` factory.
  - [x] 6.4 Write the following cases:
    1. **`utcDayBoundary` returns midnight UTC of the same calendar day** — `ref = 2026-05-12T15:42:37Z` → `'2026-05-12T00:00:00.000Z'`.
    2. **`utcMonthBoundary` returns the 1st of the calendar month at 00:00Z** — `ref = 2026-05-12T15:42:37Z` → `'2026-05-01T00:00:00.000Z'`.
    3. **`utcYearBoundary` returns Jan 1 at 00:00Z** — `ref = 2026-05-12T...` → `'2026-01-01T00:00:00.000Z'`.
    4. **DST is irrelevant** — `ref = 2026-03-08T07:42:37Z` (US spring-forward day at 02:42 local in PDT). `utcDayBoundary` returns `'2026-03-08T00:00:00.000Z'` unchanged. Asserts UTC-anchored semantics.
    5. **Factory returns deltas vs. seeded snapshots** — Seed file with two entries: `(2026-05-12T00:00:00.000Z, peer-1, USD, '1000000')` and `(2026-05-01T00:00:00.000Z, peer-1, USD, '500000')`. Inject `now = 2026-05-12T15:42Z` and `currentLifetime = '1234567'`. Expect `today = '234567'` (1234567-1000000), `month = '734567'` (1234567-500000), `year = '1234567'` (no year-boundary snapshot present so subtract against 0 — wait, no: "no boundary snapshot → '0'" per AC #3). Re-read: AC #3 says "when no boundary snapshot exists yet … the delta defaults to '0'". So if `findSnapshotAt(yearBoundary)` returns `null`, `year = '0'`. **The dev MUST follow AC literally here — the alternative (treat-as-zero-and-subtract) gives `lifetime`, which is plausible but isn't what the AC says.** See Open Question 7.
    6. **Apex scope** — Factory's `scope: '__apex__'` correctly looks up rows with `peerId === '__apex__'`.
    7. **Unknown scope returns `'0'`** — Looking up a peerId that has no snapshot rows returns `{today: '0', month: '0', year: '0'}`.
    8. **Clock-skewed snapshot (`ts > now`) is filtered out** — Seed `(2026-05-15T00:00:00Z, peer-1, USD, '999999999')` with `now = 2026-05-12`. Factory returns deltas based on the 2026-05-12 snapshots (or `'0'` if absent), NOT the future one.
    9. **Negative delta is clamped to `'0'`** — Seed snapshot with `claimsReceivedTotal > currentLifetime` (degenerate / corrupt state). Factory returns `today = '0'` (subOrZero clamp).
    10. **Malformed line in the file is skipped without crashing** — File contains `line1 (valid)`, `line2 (corrupt JSON)`, `line3 (valid)`. Factory completes; returns deltas from line1 + line3.
    11. **BigInt precision: 18-decimal asset (ETH)** — Seed `currentLifetime = '999999999999999999'` (18 zeros), snapshot `claimsReceivedTotal = '500000000000000000'`. Delta = `'499999999999999999'`. Asserts BigInt path (Number would lose precision past 2^53).
    12. **Perf: 9500-entry fixture → single `DeltaComputer` call <100ms** — Generate fixture in the test (deterministic generator: 9500 hourly snapshots for one peer × one asset starting 2025-04-12). Write to tmp file. Time the call with `performance.now()`. `expect(elapsedMs).toBeLessThan(100)`. Assert `statSync(path).size < 2 * 1024 * 1024`.

- [x] **Task 7: Property-based tests via fast-check — `snapshot-reader.property.test.ts` (AC: 5)**
  - [x] 7.1 Create `packages/townhouse/src/earnings/snapshot-reader.property.test.ts`. **This is the first fast-check usage in the package — keep the file scoped, well-commented, and don't pollute it with non-property tests.**
  - [x] 7.2 Property generators:
    ```typescript
    // Generates a sequence of hourly snapshot entries with monotonic
    // claimsReceivedTotal, spanning a generated date range. Used as the
    // input for sum-of-deltas + monotonicity invariants.
    const snapshotSequence = fc
      .tuple(
        fc.date({ min: new Date('2025-01-01'), max: new Date('2027-01-01') }), // start
        fc.integer({ min: 24, max: 9500 }),  // hours of data
        fc.array(fc.tuple(fc.constantFrom('peer-1', 'peer-2', '__apex__'), fc.constantFrom('USD', 'ETH')), { minLength: 1, maxLength: 6 })  // scopes/assets to track
      )
      .chain(([start, hours, scopes]) => fc.tuple(
        fc.constant(start), fc.constant(hours), fc.constant(scopes),
        // monotonic increments per scope×asset
        fc.array(fc.bigInt({ min: 0n, max: 10000000n }), { minLength: hours * scopes.length, maxLength: hours * scopes.length })
      ));
    ```
  - [x] 7.3 Write the following properties (use `fc.assert(fc.property(...), { numRuns: 100 })` — fast-check default; CI doesn't need higher):
    1. **Monotonicity holds** — For every generated sequence, consecutive rows for the same `(peerId, assetCode)` have non-decreasing `claimsReceivedTotal`. The generator's running-sum design enforces this; the property re-asserts it post-write (sanity check the generator).
    2. **Sum-of-deltas (telescoping)** — Pick a random `now` inside the generated range. Compute `TODAY`, `MONTH`, `YEAR` via the factory. Assert: `MONTH >= TODAY` AND `YEAR >= MONTH` (deltas accumulate). Edge case: if `now` is in January, `YEAR === MONTH` is a valid possibility (year-boundary === month-boundary === most recent snapshot before `now`). The property must accommodate that — use `>=`, not `>`.
    3. **DST is a no-op** — Generate a sequence that crosses 2026-03-08 (US spring) AND 2026-03-29 (EU spring). Factory results computed against `now` on each side of the boundary are stable (the only "jump" in deltas is the snapshot-cadence jump from the natural hourly progression — NOT a 1-hour skew from DST).
    4. **Year boundary** — Generate a sequence that crosses 2026-12-31 → 2027-01-01. Factory results for `now = 2027-01-01T00:30:00Z` show `YEAR` reset (the 2027-01-01T00:00:00Z snapshot, if present, is the year-boundary baseline; if absent, `year = '0'` per AC #3).
    5. **No-crash on corruption** — Generate a sequence, then inject corruption: a malformed line, a truncated final line (no `\n`), a line with a non-string `peerId`, a line with `claimsReceivedTotal: '-1'` (negative — should be rejected by the parser? or treated as zero? — defer to dev to decide; document in dev notes). Property asserts: factory call returns `{today, month, year}` strings (no throw, no NaN, no undefined).
    6. **Clock skew shrinkage** — Generate a sequence; pick a `now` BEFORE every snapshot's `ts`. Factory returns `{today: '0', month: '0', year: '0'}` (no future snapshots are used as baselines).
  - [x] 7.4 Run `pnpm --filter @toon-protocol/townhouse test src/earnings/snapshot-reader.property.test.ts` — confirm all properties pass with 100 runs each. Confirm runtime stays under 30s wall clock (fast-check's default shrinking can be slow; tune `numRuns` down to 50 if needed but NOT below 30 — the property catches DST/year bugs that hand-rolled unit tests miss).

- [x] **Task 8: Update exports + verify (AC: all)**
  - [x] 8.1 Edit `packages/townhouse/src/index.ts`. Add a Story 47.3 section near the existing 47.2 re-export block:
    ```typescript
    // Story 47.3 — hourly earnings snapshot writer + reader (DeltaComputer factory).
    export { SnapshotWriter } from './earnings/snapshot-writer.js';
    export type { SnapshotEntry, SnapshotWriterOptions } from './earnings/snapshot-writer.js';
    export {
      createDeltaComputer,
      utcDayBoundary,
      utcMonthBoundary,
      utcYearBoundary,
    } from './earnings/snapshot-reader.js';
    ```
  - [x] 8.2 `pnpm --filter @toon-protocol/townhouse build` — must be clean. No new typecheck errors.
  - [x] 8.3 `pnpm --filter @toon-protocol/townhouse test` — full unit suite green. Expect net delta of +15 to +25 tests (snapshot-writer.test.ts ~11 cases + snapshot-reader.test.ts ~12 cases + snapshot-reader.property.test.ts ~6 properties).
  - [x] 8.4 `pnpm --filter @toon-protocol/townhouse test src/earnings/` — earnings module tests still run sub-1s for the non-property tests; property tests may push the earnings folder to ~30s. Confirm property tests don't dominate (run them in isolation first to measure).
  - [x] 8.5 `pnpm --filter @toon-protocol/townhouse test contract-canary` — 43 tests sub-500ms (UNCHANGED — this story does NOT touch the canary).
  - [x] 8.6 `pnpm eslint` on townhouse — no new warnings. Watch for `no-unused-vars` on the `DeltaComputer` type import in `snapshot-reader.ts` (it's used in the return type only).
  - [x] 8.7 Self-review against AC list: (a) JSONL shape matches AC #2; (b) `__apex__` sentinel matches the aggregator's expectation; (c) `0o600` mode asserted on first write AND on rewrite; (d) 13-month retention; (e) reader tolerates corruption; (f) `createDeltaComputer` returns a function that matches the 47.2 `DeltaComputer` signature byte-for-byte (no shim needed in 47.4).
  - [x] 8.8 Update sprint-status to `review`. Populate `### Review Findings` with a dated entry: Open Questions 1–7 resolutions, any deviations from recommended defaults, fast-check runtime measured.

- [x] **Task 9: Live writer smoke (AC: 1)**
  - [x] 9.1 Smoke-test on a real apex (optional but recommended): `pnpm --filter @toon-protocol/townhouse-api build:docker` (or whatever produces the townhouse-api image with this story's code), `townhouse hs up`, wait ~5 seconds, then `cat ~/.townhouse/earnings-snapshots.jsonl | jq .` — assert at least one entry shows up if `fireOnStart` is enabled for the smoke build, OR wait an hour (don't actually do this — flip `tickIntervalMs` to 5_000 in a local build for the smoke). `townhouse hs down` — assert the next `townhouse hs up` reuses the file without errors. **Document the smoke result in Review Findings** even if "skipped — done in 47.5 live gate instead" (47.5 will run the full E2E gate; this story's live smoke is optional).
  - [x] 9.2 Confirm `host.json`, `connector.yaml`, `nodes.yaml`, and `earnings-snapshots.jsonl` all coexist under `~/.townhouse/` with `0o600` mode and the directory is `0o700`.

## Dev Notes

### Story Mission — Time-Series From a Cumulative-Only Source

The connector ships **cumulative** earnings totals (`claimsReceivedTotal`, `connectorFees[].total`). It does NOT ship windowed totals (today/month/year). The connector team has been clear: they will not add windowed endpoints — the connector is a generic ILP router, and "today" depends on the operator's time zone, anchoring policy, and dashboard semantics. Townhouse owns the windowing.

This story is the time-series side: snapshot the cumulative numbers once per hour, store the JSONL, and subtract the right historical baseline at read time. The dashboard never sees a "windowed claim count" from the connector — it only ever sees `lifetime` (from 47.2) and `today / month / year` (from this story's reader).

**Hard rules:**

1. **Cumulative is cumulative.** The snapshot's `claimsReceivedTotal` is the connector's value at the tick. The DELTA happens in the reader, not in the writer. The writer never subtracts; it only appends.
2. **UTC, always.** Boundaries are UTC midnight, UTC 1st-of-month, UTC 1st-of-year. Local time / DST / time zone preferences are an Epic 48 dashboard concern (UX-DR1, not this story).
3. **`__apex__` sentinel.** Apex routing fees are stored under `peerId: '__apex__'` so the same JSONL serves both apex and peer lookups. The aggregator (47.2) passes `scope: '__apex__'` to the `DeltaComputer` for apex rows — this matches.
4. **No throws from the tick.** The writer runs in a background interval; an unhandled rejection from the tick would log-spam but not crash the apex. Wrap the `getEarnings()` call in try/catch + `logger.warn`; skip the tick on failure; retry next hour.
5. **No cross-call cache in the reader (v1).** The reader re-reads the file on every `DeltaComputer` call. At 9500 entries / 1.4MB, this is acceptable. At 86k entries (full fleet × 13 months), an in-process LRU helps — but it's premature optimization for v1. Open Question 6 covers the path forward.
6. **No backward-compat shims.** This story does NOT need to read pre-existing snapshot files (there are none — this is a new file). If a future story changes the JSONL schema, that story owns the migration.

### Time, Tick Cadence & Boundary Math

The interval is `setInterval(tick, 3_600_000)` — fires every hour from the moment `start()` is called. **It does NOT fire on the wall-clock hour** (e.g., not at HH:00:00). The first tick is N minutes after apex boot, where N is anywhere from 0 to 60.

**Why not align to the wall clock?** Two reasons:

1. **Boundary math doesn't need it.** The reader computes deltas against UTC midnight / month / year boundaries, and looks up the most-recent snapshot `ts <= boundary`. If the writer fires at HH:23:00 instead of HH:00:00, the "midnight" snapshot used as the day-boundary baseline is the one from 23:00 the previous day — still well-defined, still monotonic, just off by ~1 hour.
2. **Alignment is fragile.** Wall-clock alignment requires a one-shot `setTimeout` to the next hour, then `setInterval` after that. Each hour's `setTimeout` has accumulated drift (timer skew on a busy event loop). The simple `setInterval(tick, 3_600_000)` from boot is bounded-drift (a few ms per hour, never more) and survives apex restarts cleanly (each restart starts a fresh interval).

**Floor `ts` to the hour:** `new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000)`. This ensures:

- Two ticks fired ~3.6 seconds apart (e.g. after a fake-timer test) emit the SAME `ts`. This is acceptable (the data deduplicates against `(peerId, assetCode, ts)` if a future story adds a dedup step) — but for v1 the writer just appends, and the reader picks the latest `ts <= boundary`. If duplicates exist for the same `ts`, the reader's behavior is well-defined: whichever line appears later in the file wins (or, equivalently, the reader sorts by `ts` desc and breaks ties on file order).
- A tick that fires at 03:00:01 (1 second after spring-forward; DST is irrelevant in UTC, but the wall-clock would skew) still produces `ts = '...T03:00:00.000Z'`.

### Mid-Write Truncation Recovery

The append is `fs.appendFile(path, line)`. On POSIX, this is `O_APPEND | O_WRONLY` + `write(2)` — atomic for writes ≤ PIPE_BUF (4096 bytes on Linux). For writes > PIPE_BUF, the kernel may interleave with other writers (we don't have any, but: defensive). A SIGKILL between `write()` calls leaves the file with a partial line ending mid-character.

**Recovery is lazy:** the reader skips malformed lines silently (try-parse, on-throw drop). The next write proceeds normally — if the file ends without a `\n`, the next `appendFile` adds content after the partial line, which creates a frankenline. To prevent this, the writer's append starts with `'\n'` IFF the file's last byte is not `\n`:

```typescript
// Optional defensive prefix: only if the file ends without a newline.
const stat = await fs.stat(snapshotPath).catch(() => null);
const needsPrefix = stat && stat.size > 0 && await endsWithoutNewline(snapshotPath);
const body = (needsPrefix ? '\n' : '') + lines.map(JSON.stringify).join('\n') + '\n';
```

Where `endsWithoutNewline` reads the last byte via `fs.read` on a small buffer. **For v1, skip the defensive prefix and rely on the lazy prune** — the pruner rewrites the file cleanly on its next pass, repairing any frankenline as a side effect. The cost of skipping is "the next reader sees a corrupt frankenline until pruning fires," which (a) the reader skips silently anyway, and (b) is rare (requires SIGKILL between `write()` calls).

**Decision deferred to the dev:** ship the defensive prefix if the dev wants to be principled; defer if "lazy compaction repairs it anyway" is acceptable. Document the choice in Review Findings.

### Open Question 1 — Apex Row Storage: `__apex__` Sentinel vs. Separate File

The epic AC at line 896 says: "appends one JSON-per-line entry to `~/.townhouse/earnings-snapshots.jsonl` of shape `{ts, peerId, assetCode, claimsReceivedTotal}` for each peer × asset". It does NOT mention apex routing fees.

**Three possible interpretations:**

1. **(Recommended)** Extend the schema: apex rows use `peerId: '__apex__'`. Same file, same shape, same code path. Reader switches on `peerId === '__apex__'` IFF it needs to (it doesn't — the factory's `scope` arg matches `peerId` directly).
2. Separate file: `apex-earnings-snapshots.jsonl`. Two writers, two readers, no sentinel value. Cleaner schema, more code.
3. Don't snapshot apex routing fees at all in this story. Defer to 47.4 (which already wraps "apex.routingFees" semantically in the wire shape — the dashboard could just show `lifetime` for apex without TODAY/MONTH/YEAR deltas).

**Default action:** (1). The `'__apex__'` sentinel is internal — operators see "apex routing fees" in the dashboard — and the single-file schema keeps the reader trivial. If the dev disagrees, escalate to Alice (PM) or Winston (architect) before merging.

### Open Question 2 — Append Strategy: Per-Line `appendFile` vs. Multi-Line Batched

Per-line `appendFile` (N syscalls per tick, each ≤150 bytes) is trivially atomic but expensive at the metric level (N=9 for v1 is fine; N=86 for a hypothetical 86-peer fleet starts to matter).

Multi-line `appendFile` (1 syscall per tick, up to N×150 bytes) is one syscall but only atomic for ≤PIPE_BUF bytes. Above PIPE_BUF, the kernel may split; with only one writer process, the split is irrelevant — but defensive coders fear the future.

**Three options:**

1. **(Recommended)** Multi-line batched, with size capping at PIPE_BUF: if the buffer exceeds 4096 bytes, split into chunks and call `appendFile` per chunk. Maintains POSIX atomicity guarantees AND minimizes syscall count.
2. Per-line. Simple, slow, atomic. Acceptable at v1 scale.
3. Multi-line, no size cap. Simplest, fastest, technically vulnerable to interleaved writes — but townhouse has exactly one writer at a time (the apex), so the vulnerability is theoretical.

**Default action:** (1). If the dev prefers simplicity (3), document that townhouse is a single-writer system and the cap is YAGNI.

### Open Question 3 — Pruning Watermark

If the file is below a size watermark, skip pruning (the read-filter-rewrite is wasteful when the file isn't large enough to need it). Above the watermark, prune on every tick.

**Possible watermarks:**

1. **(Recommended)** 256KB ≈ 1700 entries — comfortably above one month of data at v1 scale (3 peers × 3 assets × 720 hours/month = 6480 entries, but 1 peer × 1 asset = 720 entries/month). Below the watermark, pruning is unnecessary; above, the file is at least 1 month old AND has enough data that the rewrite cost is justified.
2. Prune unconditionally on every tick. Simpler logic; ~10ms wasted per tick at the small-file extreme. Acceptable.
3. Prune only on apex boot. The writer registers a one-shot prune at `start()`. Cheaper steady-state; "13 months retention" becomes "13 months minus your last apex restart" which is functionally the same for any operator that restarts at all.

**Default action:** (1) — 256KB watermark, prune on every tick above it. If the dev wants (3), document the semantic shift.

### Open Question 4 — Inject Writer via `ApiDeps` vs. Construct Inside `createApiServer`

The writer is the kind of dep that COULD be injected (`ApiDeps.snapshotWriter`) so tests can pass a stub, AND so the wizard server / future server factories don't need to re-construct it.

**Three options:**

1. **(Recommended)** Construct inside `createApiServer`. The wizard server doesn't need earnings (wizard runs PRE-apex). No injection point needed. Tests construct the writer directly + pass its `tick` method via a test-only API server factory, OR test the writer in isolation (Task 6) AND assert wiring via a `createApiServer` integration test that just verifies `start()` was called — not the writer's behavior.
2. Inject via `ApiDeps`. Cleaner test surface but more boilerplate AND a new field on the deps interface that every existing test fixture has to populate.
3. Construct inside `createApiServer`, but expose a getter on `ApiServer` (`apiServer.snapshotWriter`) so tests can prod it. Bad — leaks internals.

**Default action:** (1). The writer's behavior is unit-tested in isolation; the wiring is integration-tested via a single "writer.start was called" assertion (use a `vi.spyOn(SnapshotWriter.prototype, 'start')` in `server.test.ts` — see if a `server.test.ts` exists; if not, defer the wiring assertion to a manual smoke per Task 9).

### Open Question 5 — UTC vs. Local-Time Boundaries

UTC is the v1 choice (per Dev Notes "Hard rules" §2). The risk: an operator in UTC+12 sees "today" reset at noon their time, which is weird. The dashboard (Epic 48) can render a "TODAY (UTC)" label, OR re-interpret the snapshot data in their local zone, OR negotiate a per-operator zone setting (UX-DR1).

**For v1, UTC is fine** — Drew is in PST per the epic doc, and "today resets at 4pm local" is OK for a power-user dashboard that ships as a TUI. The full TZ story lands with Epic 48's UX work. **No action in this story.**

### Open Question 6 — Reader Cache

Every dashboard poll (5s metrics-ws cadence) triggers a `GET /api/earnings` → aggregator → `DeltaComputer` per (peer×asset + apex×asset). For 9 deltas per poll, the reader re-reads the file 9 times — 9 × 1.4MB = 12.6MB of I/O every 5 seconds. At v1 scale (≤9 deltas × ≤1.4MB file × 5s poll), this is ~2.5 MB/s — acceptable on any modern host, but not free.

**Three options for v1:**

1. **(Recommended)** No cache. Re-read on every call. Simple, correct, NFR4-compliant. Performance fix is a follow-up if it bites.
2. In-call cache: the factory reads the file ONCE per `DeltaComputer` invocation, caches the parsed map, computes all three boundaries (today/month/year) from the cache, then discards. Cuts reads from 9× to 3× per poll. Trivial change.
3. Cross-call LRU: the factory caches the parsed map for ~30 seconds (configurable). Cuts reads to ~once per 30s. More complex; cache invalidation if the writer appends between calls.

**Default action:** (1). If perf measurement in Task 6.4 case 12 fails the 100ms NFR, fall back to (2) — the per-call cache is a 10-line change and doesn't introduce stale data semantics. (3) is deferred to a future perf story OR Epic 48 if the TUI's poll cadence makes it bite.

### Open Question 7 — Missing Boundary Snapshot: `'0'` vs. Lifetime

AC #3 says: "when no boundary snapshot exists yet (e.g. first hour after `townhouse hs up`), the delta defaults to `'0'`".

This is unintuitive: if there's no day-boundary snapshot AT ALL (apex just booted), then "today" should arguably be the full `currentLifetime` (everything that's ever happened, since we don't know what was "before today"). But the AC is explicit: `'0'`.

**Why `'0'`?** Because the alternative (lifetime as today) would mean every fresh apex shows TODAY equal to LIFETIME for the first day, then suddenly drops to a small number once the day-boundary snapshot appears. That discontinuity is more confusing than a zero start.

**Default action:** follow AC #3 literally. `'0'` on missing snapshot. Document the trade-off in Review Findings.

### Files This Story Modifies

- `packages/townhouse/src/earnings/snapshot-writer.ts` — NEW, ~150 lines.
- `packages/townhouse/src/earnings/snapshot-writer.test.ts` — NEW, ~250 lines.
- `packages/townhouse/src/earnings/snapshot-reader.ts` — NEW, ~120 lines.
- `packages/townhouse/src/earnings/snapshot-reader.test.ts` — NEW, ~200 lines.
- `packages/townhouse/src/earnings/snapshot-reader.property.test.ts` — NEW, ~150 lines (fast-check).
- `packages/townhouse/src/api/server.ts` — UPDATE (~10 lines: construct + start + stop).
- `packages/townhouse/src/index.ts` — UPDATE (~6 lines of re-exports).
- `packages/townhouse/package.json` — UPDATE (add `fast-check` to `devDependencies`).

### Files This Story Does NOT Modify

- `packages/townhouse/src/earnings/aggregator.ts` — consumed unchanged. The `DeltaComputer` type defined here is what `createDeltaComputer` returns.
- `packages/townhouse/src/api/routes/earnings.ts` — left alone. 47.4 will wire `deltaComputer: createDeltaComputer({ snapshotPath })` into the `aggregateEarnings()` call.
- `packages/townhouse/src/api/types.ts` — `ApiDeps` is unchanged (Open Question 4 default).
- `packages/townhouse/src/connector/admin-client.ts` — consumed unchanged.
- `packages/townhouse/src/connector/types.ts` — consumed unchanged.
- `packages/townhouse/src/connector/contract-canary.test.ts` — UNCHANGED (this story does not change the connector contract).
- `packages/townhouse/src/__integration__/connector-image-contract.test.ts` — UNCHANGED.
- `packages/townhouse/src/state/nodes-yaml.ts` — UNCHANGED (read once during route handling — that's 47.2's surface, not this story).
- `packages/townhouse/src/reconciler.ts` — UNCHANGED (a separate JSONL appender; its pattern is referenced for the writer's append path but the file itself is not edited).
- `packages/townhouse/compose/townhouse-hs.yml` — UNCHANGED. The existing `${TOWNHOUSE_HOME}:/.townhouse:rw` bind mount covers the new file.
- `docker/src/entrypoint-townhouse-api.ts` — UNCHANGED. The writer is owned by `createApiServer`.
- `packages/sdk/CONNECTOR_MIGRATION.md` — UNCHANGED (no connector contract change).
- `packages/townhouse-web/src/components/earnings-panel.tsx` — UNCHANGED. 47.4 will surface today/month/year via the route; this story just produces the data backing those fields.

### Test Strategy Notes

- **Three test files, three roles.** `snapshot-writer.test.ts` proves the writer appends + prunes + handles failures (file-IO focused, fake timers). `snapshot-reader.test.ts` proves the boundary helpers + `createDeltaComputer` factory return correct deltas (math focused, no I/O beyond the seed file). `snapshot-reader.property.test.ts` proves correctness under adversarial inputs (DST / year boundary / corruption) via fast-check. Keep the three concerns separated — DO NOT cross-pollinate.
- **`vi.useFakeTimers()` for the writer's interval.** Pattern: `vi.useFakeTimers({ now: someDate, toFake: ['setInterval', 'setTimeout', 'Date'] })` in `beforeEach`; `vi.useRealTimers()` in `afterEach`. Advance the clock with `vi.advanceTimersByTime(3_600_000)`.
- **`mkdtempSync` for temp file fixtures.** Pattern: `const tmpHome = mkdtempSync(join(tmpdir(), '47-3-'));` in `beforeEach`; `rmSync(tmpHome, { recursive: true, force: true })` in `afterEach`. Snapshot path lives at `join(tmpHome, 'earnings-snapshots.jsonl')`.
- **No snapshot tests (vitest's `.toMatchSnapshot`).** The on-disk JSONL is content-addressable — `JSON.parse(line).toEqual(expected)` is clearer than `.toMatchSnapshot()` for these. Snapshot tests rot.
- **Property tests use `fc.assert({ verbose: true })` to surface shrinking failures.** When a property fails, fast-check shrinks the input to a minimal counterexample. Verbose mode prints the shrinking path — invaluable for "why does the year boundary fail at exactly 2026-12-31T23:59:59.999Z".
- **Property test runtime budget: 30s.** If property tests start to dominate, drop `numRuns` from 100 → 50 (still catches ≥90% of bugs per fast-check author's heuristic). DO NOT skip property tests under CI — they catch the bugs that hand-rolled tests miss (DST, year boundaries, BigInt edge cases).

### Connector Endpoint Behavior — 503 Path (Snapshot Writer's Take)

Per Story 47.1: `GET /admin/earnings.json` returns 503 when settlement subsystem isn't booted. The aggregator (47.2) catches this and returns `status: 'connector_unavailable'`. The snapshot writer also catches it — and `logger.warn`s, then skips the tick. The tick after that retries. By the time the dashboard polls, the writer may have populated one snapshot (if the connector recovered between tick N and tick N+1) OR no snapshots (if the connector is still down). Either way, the reader returns `'0'` for missing baselines — the dashboard sees zeros + the aggregator's `status: 'connector_unavailable'` banner.

**No coordination between writer and aggregator on the 503 state.** Two independent consumers of the same connector endpoint, each with their own failure-mode logic. Keeps the surface narrow.

### Git History Intelligence (last 5 commits)

```
a4c4e45 feat(47.2): aggregator earnings surgery + code-review patches
f60b3ea feat(47.1): getEarnings() admin-client wrap + contract canaries
a4124af chore(46.4 + retro): close Epic 46 + flip retrospective to done (#58)
f3d1d3f fix(townhouse-hs): integration fixes L + M + N + O (gate now 4/5 passing) (#55)
6d0ff13 fix(publish): native arm64 runners — drop QEMU, fix DVM SIGILL (#57)
```

Relevance to this story:

- **#a4c4e45 (47.2):** the direct predecessor. Lands the `DeltaComputer` type and the `AggregateEarningsInput.deltaComputer?` slot this story plugs into. Re-read 47.2's `### Review Findings` — especially the "graceful empty" + `Promise.all` fan-out semantics. The writer's failure mode (skip-tick-on-getEarnings-failure) mirrors the aggregator's catch.
- **#f60b3ea (47.1):** ships `connectorAdmin.getEarnings()`. The writer's only consumer of the admin client.
- **#a4124af (Epic 46 close):** introduces `~/.townhouse/nodes.yaml`, `~/.townhouse/host.json`, `~/.townhouse/reconciler.log` patterns. The new `earnings-snapshots.jsonl` joins this neighborhood with the same mode (`0o600`) + atomic-write conventions.
- **No commits in the last 5 touch `packages/townhouse/src/earnings/` beyond 47.1 + 47.2.** Clean baseline.

### Project Context Reference

- **Coding rules / patterns / conventions:** see `_bmad-output/project-context.md` (loaded as persistent fact during activation). Key sections:
  - ESM `.js` extensions on relative imports (`from './snapshot-writer.js'`, NOT `'./snapshot-writer'`).
  - `pnpm --filter <pkg> test` pattern — never `pnpm test` at workspace root.
  - Sub-agent RAM guidance — keep test invocations narrow; property tests can be slow.
  - File mode `0o600` on every operator-secret file (NFR8) — this story's snapshot file inherits the rule.
- **47.2 implementation:** `_bmad-output/implementation-artifacts/47-2-aggregator-earnings-surgery.md` — the predecessor; locks the `DeltaComputer` signature this story implements.
- **47.1 implementation:** `_bmad-output/implementation-artifacts/47-1-sdk-get-earnings-wrap-and-contract-canary.md` — the consumed `getEarnings()` method.
- **Epic 47 spec:** `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:882-925` (this story) + 47.4 / 47.5 for downstream context. FR16, NFR4, NFR8, NFR11, NFR12.
- **JSONL append precedent:** `packages/townhouse/src/reconciler.ts:179-210` — single-line append with `0o600` mode + post-create chmod.
- **Atomic file rewrite precedent:** `packages/townhouse/src/state/nodes-yaml.ts:96-111` — tmp-file + rename + chmod.
- **Background timer precedent:** `packages/townhouse/src/api/routes/metrics-ws.ts:205-246` — `setInterval` + re-entrancy guard via a `pending` flag.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-12)

### Debug Log References

### Completion Notes List

- Implemented `SnapshotWriter` class with hourly tick, PIPE_BUF-split append, 256KB watermark pruning, re-entrancy guard, and `0o600` file mode. Pattern follows `reconciler.ts` (append) + `nodes-yaml.ts` (atomic-rewrite).
- Implemented `createDeltaComputer` factory with single readline stream scan per call (one file read covers all three boundaries). Boundary helpers (`utcDayBoundary/Month/Year`) are pure UTC functions — DST-safe.
- Wired `SnapshotWriter` into `createApiServer` (stop called before `transportProbe.stop()`, no `ApiDeps` injection per Open Question 4 default).
- 29 new tests: 11 writer + 12 reader + 6 property (fast-check 3.23.2). Total: 994 (baseline 965).
- Open Questions 1–7 resolved per recommended defaults (see Review Findings).
- Prop 2 (sum-of-deltas) generator anchored at 2026-01-01 to guarantee all three boundary snapshots exist in every run.


### File List

- `packages/townhouse/src/earnings/snapshot-writer.ts` — NEW
- `packages/townhouse/src/earnings/snapshot-writer.test.ts` — NEW
- `packages/townhouse/src/earnings/snapshot-reader.ts` — NEW
- `packages/townhouse/src/earnings/snapshot-reader.test.ts` — NEW
- `packages/townhouse/src/earnings/snapshot-reader.property.test.ts` — NEW
- `packages/townhouse/src/api/server.ts` — UPDATED (SnapshotWriter wired in)
- `packages/townhouse/src/index.ts` — UPDATED (Story 47.3 exports added)
- `packages/townhouse/package.json` — UPDATED (fast-check ^3.21.0 added to devDependencies)


### Review Findings

_Code review 2026-05-12 — Pending first review. Implementation complete; open questions resolved below._

**Open Questions 1–7 Resolutions (2026-05-12):**
- OQ1 (apex sentinel): Chose option (1) — `__apex__` sentinel in same file. Single schema, reader requires no special handling.
- OQ2 (append strategy): Chose option (1) — multi-line batched with PIPE_BUF cap. v1 ceiling ≪ 4096 bytes; cap is forward-compatible.
- OQ3 (pruning watermark): Chose option (1) — 256KB watermark. Verified in test case 8.
- OQ4 (inject vs. construct): Chose option (1) — construct inside `createApiServer`. No `ApiDeps` field needed.
- OQ5 (UTC vs. local): UTC anchored. v1 decision; Epic 48 UX-DR1 owns TZ work.
- OQ6 (reader cache): No cache (option 1). 9500-entry perf test passes <100ms (case 12).
- OQ7 (missing boundary): Returns `'0'` per AC #3 literal. Documented trade-off: zero on first day vs. confusing discontinuity later.

**fast-check runtime:** 6 properties × 50–100 runs = ~1s total wall clock. Well under 30s budget.

**Deviations from recommended defaults:** None. All 7 open questions resolved per recommended option.

**Negative claimsReceivedTotal in corruption fixture:** Treated as valid (passes `isSnapshotEntry` type check since it's still a string). `subOrZero` clamps the resulting negative diff to `'0'` — effectively harmless.

---

_Code review 2026-05-13 — adversarial triage across Blind Hunter + Edge Case Hunter + Acceptance Auditor. 3 decisions needed, 15 patches, 5 deferred, ~17 dismissed. AC #7 defensive-prefix decision: **deferred to lazy-compaction** (no `endsWithoutNewline` probe in writer; pruner repairs any frankenline on next rewrite). Reader's `JSON.parse` skip-on-throw means a frankenline is silently ignored between writer crash and the next prune cycle. This matches Dev Notes "Mid-Write Truncation Recovery" §358 "lazy compaction repairs it anyway" path._

**Decisions resolved 2026-05-13:**
- **D1 → Simplify to one `appendFile`.** Delete the PIPE_BUF split branch (`snapshot-writer.ts:163-183`). PIPE_BUF is a pipe/FIFO atomicity guarantee, not a regular-file one; townhouse is single-writer so there is no interleave threat. Becomes patch **P_D1**. Resolves P2 as **dismissed** (no spy needed for a branch that no longer exists).
- **D2 → `logger.warn` every skip.** Re-entrancy guard at `snapshot-writer.ts:90-91` should log on every dropped tick so operators can see when getEarnings is wedged. Becomes patch **P_D2**.
- **D3 → Leave (matches precedent).** `reconciler.ts` / `nodes-yaml.ts` don't fsync either; staying consistent with the existing codebase pattern. No patch.
- [x] [Review][Patch] **P_D1** — Deleted PIPE_BUF split branch; `appendEntries` now uses one `fs.appendFile` regardless of body size [`snapshot-writer.ts:177-194`] (D1 resolution)
- [x] [Review][Patch] **P_D2** — Re-entrancy guard logs `logger.warn` on every dropped tick [`snapshot-writer.ts:88-95`] (D2 resolution)
- [x] [Review][Patch] **P1** — Post-prune `0o600` mode asserted in writer test case 9 [`snapshot-writer.test.ts:387-390`]
- [x] [Review][Dismiss] **P2** — PIPE_BUF spy dismissed; branch removed by P_D1
- [x] [Review][Patch] **P3** — AC #7 defensive-prefix decision documented in Review Findings (lazy compaction; reader's `JSON.parse` skip-on-throw handles frankenline between writer crash and next prune)
- [x] [Review][Patch] **P4** — `start()` now idempotent — early-return if `this.timer !== null` [`snapshot-writer.ts:68`]
- [x] [Review][Patch] **P5** — Dropped `appendDirEnsured` / `appendChmodEnsured` flags; `mkdir` + `chmod` run on every append (cheap-idempotent) [`snapshot-writer.ts:165-184`]
- [x] [Review][Patch] **P6** — `runTick` now wraps append + prune in try/catch + `logger.warn`; writer no longer escapes errors into the apex event loop [`snapshot-writer.ts:121-159`]
- [x] [Review][Patch] **P7** — Defensive skip of a peer with `peerId === '__apex__'` + `logger.warn` [`snapshot-writer.ts:127-135`]
- [x] [Review][Patch] **P8** — Nullish-coalesce `earnings.peers ?? []` and `earnings.connectorFees ?? []` and `peer.byAsset ?? []` [`snapshot-writer.ts:125, 136, 144`]
- [x] [Review][Patch] **P9** — `findBestMatch` docstring updated; no longer claims sorted input [`snapshot-reader.ts:106-110`]
- [x] [Review][Patch] **P10** — Reader compares boundaries numerically via `Date.parse` (robust against any ISO variant) [`snapshot-reader.ts:78-80, 115-123, 144-148`]
- [x] [Review][Patch] **P11** — `subOrZero` now clamps negative baseline to `'0'` (prevents corrupt-row inflation) [`snapshot-reader.ts:172-176`]
- [x] [Review][Patch] **P12** — Writer test case 8 now spies on `fs.promises.writeFile` + `fs.promises.rename` and asserts both NOT called [`snapshot-writer.test.ts:329-352`]
- [x] [Review][Patch] **P13** — `readSnapshotMap` now returns empty map on stream error (instead of a partial-read result the caller would treat as authoritative) [`snapshot-reader.ts:62-104`]
- [x] [Review][Patch] **P14** — `createDeltaComputer` guards against NaN-time clock injection (`Number.isFinite(ref.getTime())`) [`snapshot-reader.ts:140-144`]
- [x] [Review][Patch] **P15** — Property test 5 corruption fixture now includes a non-string `peerId` row (Task 7.3 prop 5) [`snapshot-reader.property.test.ts:211-212`]

**Verification:** `pnpm --filter @toon-protocol/townhouse test` → **994 passed / 65 files** (965 baseline + 29 new tests from 47.3). Earnings module alone: 58 passed / 5 files in 1.78s (snapshot-reader.property.test.ts: 1.20s — well under 30s budget). `pnpm --filter @toon-protocol/townhouse build` → clean.
- [x] [Review][Defer] W1 — No cross-call reader cache; 9× file-reads per dashboard poll [`snapshot-reader.ts:128-148`] — deferred, resolved in OQ6 as v1 acceptable
- [x] [Review][Defer] W2 — Pruner loads entire file into RAM via `fs.readFile` (no streaming filter) [`snapshot-writer.ts:212`] — deferred, watermark caps practical risk at v1 scale
- [x] [Review][Defer] W3 — Stale `.tmp` from a previous crash is silently overwritten by `writeFile` [`snapshot-writer.ts:242-244`] — deferred, recoverable on next prune
- [x] [Review][Defer] W4 — `fs.rename` fails with EXDEV across filesystem boundaries [`snapshot-writer.ts:245`] — deferred, single bind-mount in Docker means no real EXDEV path today
- [x] [Review][Defer] W5 — `setInterval(tick, 3_600_000)` drift over hours/days [`snapshot-writer.ts:73-75`] — deferred, Dev Notes §"Time, Tick Cadence" explicitly accepts bounded drift

## Story Close-Out Checklist

- [ ] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section.
- [ ] Does this story contain regex or template substitution logic? **No** — pure file IO + date math. Skip this checkbox.
- [ ] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? Property tests run in the normal vitest suite — confirm NO new gates were added. If a flaky property test was gated, comment with `// Gate: <condition>. Run before marking story done.` per CLAUDE.md story-close-out rule.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test src/earnings/snapshot-writer.test.ts` AND `src/earnings/snapshot-reader.test.ts` run sub-1s (no I/O beyond temp dirs).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test src/earnings/snapshot-reader.property.test.ts` runs under 30s wall-clock. If over, tune `numRuns` BEFORE marking story done.
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test` passes with a net delta of +15 to +25 tests over the 47.2 baseline (965 tests).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse build` is clean (no typecheck errors).
- [ ] Verify `pnpm --filter @toon-protocol/townhouse test contract-canary` still passes sub-500ms, 43 tests (UNCHANGED).
- [ ] Verify `fast-check` is in `devDependencies` of `packages/townhouse/package.json` (NOT `dependencies`).
- [ ] Verify the 9500-entry perf test asserts both `<100ms` AND `<2MB` (NFR4 + epic-line-912 file-size invariant).
- [ ] Verify the snapshot file's mode is `0o600` on first write AND after pruning rewrite (both code paths exercised in tests).
- [ ] Verify `createDeltaComputer` returns a function whose signature byte-for-byte matches the 47.2 `DeltaComputer` type — no shim in `aggregator.ts`, no shim in 47.4's route.
- [ ] Confirm Open Questions 1–7 are resolved per recommendation OR escalated, with the resolution documented in `### Review Findings`.
- [ ] Update sprint-status to `review` (then `done` after code review).
