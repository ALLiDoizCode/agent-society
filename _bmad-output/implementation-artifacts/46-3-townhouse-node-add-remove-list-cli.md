# Story 46.3: `townhouse node add` / `node remove` / `node list` CLI

Status: done

> **Third story of Epic 46 (Lazy Peer Node Provisioning).** Sized M. Depends on Story 46.2 (POST/DELETE `/api/nodes` host API + 6-step pipeline — done 2026-05-11). Unblocks Story 46.4 (Live E2E gate). This story is a **CLI wrapper over the existing 46.2 routes plus a NEW `GET /api/nodes` (yaml-driven) endpoint**. Two scope additions worth flagging up-front: (1) `GET /api/nodes` did not ship in 46.2 — it must ship here to satisfy AC #5; (2) the deferred D4 from 46.2 (`config.nodes[type].enabled` vs. lifecycle-add) is resolved in this story per the user-facing AC.

## Story

As a **terminal operator (Drew)**,
I want **terse CLI verbs that map 1:1 to host-API node lifecycle**,
so that **I can `townhouse node add town` and see it work without buttons or modals**.

## Acceptance Criteria

1. **Given** the CLI verbs registered in the townhouse CLI router
   **When** an operator runs `townhouse node add town`
   **Then** the CLI calls `POST /api/nodes { type: "town" }` against the local host API at `http://127.0.0.1:28090`

2. **Given** the CLI streams API progress
   **When** rendering to stdout
   **Then** progress shows as `Pulling image · Deriving wallet · Registering with apex · Live` with stages lighting up green as each completes

3. **Given** the operator runs `townhouse node add` with no type
   **When** the CLI processes args
   **Then** the default type is `town` (FR12)

4. **Given** the operator runs `townhouse node remove <id>`
   **When** the CLI processes args
   **Then** the CLI prompts for confirmation interactively unless `--yes` is passed

5. **Given** the operator runs `townhouse node list`
   **When** the CLI executes
   **Then** the CLI calls `GET /api/nodes` and prints a table with columns: `peer · type · status · last claim`

6. **Given** every CLI verb (`add`, `remove`, `list`)
   **When** invoked with `--json`
   **Then** machine-readable JSON output is emitted to stdout instead of human-formatted text (FR14)

7. **Given** the help text
   **When** an operator runs `townhouse node add --help`
   **Then** the help includes the upsell hint: `townhouse node add mill   # earn from chain swaps (5x earnings unlock)`

**FRs:** FR12, FR14

## Tasks

- [x] **Task 1: Pre-work — read modified files end-to-end (AC: all)**
  - [x] 1.1 Read `packages/townhouse/src/cli.ts` end-to-end. Confirm: `parseArgs` options table (line 1200-1220), command switch (line 1234-1351), `HS_TOWNHOUSE_API_URL = 'http://127.0.0.1:28090'` (line 757), `HELP_TEXT` (line 72-96), self-invoke pattern (line 1354-1368), `CliHelpRequested` exit-0 protocol (line 65-70).
  - [x] 1.2 Read `packages/townhouse/src/api/routes/nodes-lifecycle.ts` end-to-end. Confirm exact response shapes for POST (201 `{id,type,peerId,ilpAddress,hsRoute,healthCheckUrl}`), POST error (`{step, err, rollbackError?}` with HTTP 500/502/409), DELETE (200 `{id, type}`), DELETE error (`{step, err}` with 502/500/404), 409 `node_lifecycle_in_flight`, 409 `node_type_in_use`, 404 `unknown_node`. CLI prints these error bodies verbatim — do NOT remap status codes.
  - [x] 1.3 Read `packages/townhouse/src/api/routes/nodes.ts` lines 113-156 (existing `GET /nodes` — NOT prefixed `/api`; docker-status-driven). This story adds a NEW `GET /api/nodes` that is yaml-driven. Do NOT modify the existing `/nodes` endpoint — it powers the SPA's docker-state view.
  - [x] 1.4 Read `packages/townhouse/src/state/nodes-yaml.ts` end-to-end (117 lines). Confirm: `NodesYamlEntry` shape (`id, type, peerId, ilpAddress, derivationIndex, enabledAt, lastSeenAt`), `readNodesYaml` returns `{entries: []}` on ENOENT, zod-strict schema rejects unknown keys.
  - [x] 1.5 Read `packages/townhouse/src/cli/failure-copy.ts` end-to-end (158 lines). Reuse `renderFailure(error)` for surfacing image-pull / port-collision / missing-docker-sock errors in `node add`. Do NOT add a new copy table — extend the existing `FAILURE_COPY` map only if a new error class lands (e.g., `'registration-drift'` per UX-DR5).
  - [x] 1.6 Read `packages/townhouse/src/cli.hs.test.ts` lines 1-200 to confirm the test fixture pattern (`makeHsTestDir`, vitest mocks, `consoleSpy`, `process.exitCode` capture, `process.stdin.isTTY` shim). This story's CLI tests mirror that shape.

- [x] **Task 2: Resolve D4 from 46.2 review — `config.nodes[type].enabled` vs. lifecycle-add (AC: 1, 4)**
  - [x] 2.1 **Decision:** `townhouse node add <type>` ignores the static `config.nodes[type].enabled` flag for HS mode. `nodes.yaml` is the single source of truth in HS mode (Epic 46 lazy-provisioning architecture). The static flag remains the source of truth for `dev` profile (`townhouse up --town`).
  - [x] 2.2 Document this in a block comment at the top of the new node-commands file. Remove the `TODO(46.3)` comment from `packages/townhouse/src/api/routes/nodes-lifecycle.ts:131-134` (added as P14 in 46.2).
  - [x] 2.3 Mark deferred-work.md entry D4 (line 263 of `_bmad-output/implementation-artifacts/deferred-work.md`) as **Resolved by Story 46.3** in a one-line edit. Do NOT change the historical entry text; append a `> Resolved 2026-05-11 (Story 46.3): HS-mode nodes.yaml is the source of truth.` line.

- [x] **Task 3: NEW `GET /api/nodes` route — yaml-driven list (AC: 5)**
  - [x] 3.1 Add `app.get('/api/nodes', handler)` to `packages/townhouse/src/api/routes/nodes-lifecycle.ts` (keep all `/api/nodes*` routes co-located in this file). Place BEFORE the `POST /api/nodes` handler (Fastify ordering is fine; ordering is for human reviewer scanning).
  - [x] 3.2 Handler reads `nodes.yaml` via `readNodesYaml(nodesYamlPath)`, reads connector peer state via `deps.connectorAdmin.getPeers()`, joins them by `peerId === peer.id`, and returns the defined schema.
  - [x] 3.3 Connector errors are caught and logged at `request.log.warn` (not error — connector-down is expected during `hs up` warm-up). Response still returns nodes with `status: 'unknown'`.
  - [x] 3.4 No params, no body validation needed. Returns 200 always (or 500 only if `readNodesYaml` itself throws on disk error — that IS a real server fault).
  - [x] 3.5 Add unit tests to `packages/townhouse/src/api/routes/nodes-lifecycle.test.ts`: all 5 tests added and passing.
  - [x] 3.6 `pnpm --filter @toon-protocol/townhouse test nodes-lifecycle` — all 39 green.

- [x] **Task 4: CLI dispatch wiring — new `node` top-level command (AC: 1, 3, 4, 5)**
  - [x] 4.1 Add `node` case to the `switch (command)` block in `packages/townhouse/src/cli.ts`. Subcommands: `add`, `remove`, `list`. Unknown subcommand prints sub-help and exits 1.
  - [x] 4.2 Update `HELP_TEXT` to include the new verbs (three node lines added).
  - [x] 4.3 Add `--yes` boolean and `--json` boolean to the `parseArgs` options table.
  - [x] 4.4 Added node sub-help detection BEFORE global `--help` check so `townhouse node add --help` shows `NODE_ADD_HELP` containing the AC #7 upsell string.

- [x] **Task 5: `handleNodeAdd` — POST /api/nodes with streaming progress (AC: 1, 2, 3, 6)**
  - [x] 5.1 New file: `packages/townhouse/src/cli/node-commands.ts`. Three handlers + helpers + STEP_TO_STAGE table + D4 block comment.
  - [x] 5.2 `handleNodeAdd` implemented: validates type, prints dim stages, awaits POST, relights stages on 201, surfaces errors per step using renderFailure for pull-image/start-container.
  - [x] 5.3 120s AbortController timeout via global fetch (Node 20+).
  - [x] 5.4 Connection error → `townhouse hs up isn't running` message.
  - [x] 5.5 renderFailure reuse for pull-image; generic 3-line for other steps.

- [x] **Task 6: `handleNodeRemove` — DELETE /api/nodes/:id with confirmation (AC: 4, 6)**
  - [x] 6.1 `handleNodeRemove` implemented with id validation, regex sanitization, TTY detection, confirmation prompt.
  - [x] 6.2 Non-TTY without --yes → exit 1 with `--yes required` message.
  - [x] 6.3 `confirmInteractive` helper using readline; stubbed via `options.confirm` in tests.
  - [x] 6.4 200 → `✓ Removed <id>` or JSON `{ok:true, id, type}`.
  - [x] 6.5 404 → `✕ No node with id '<id>'` exit 1.
  - [x] 6.6 409 `node_lifecycle_in_flight` → `✕ Another node operation is in flight.` exit 1.

- [x] **Task 7: `handleNodeList` — GET /api/nodes with table rendering (AC: 5, 6)**
  - [x] 7.1 `handleNodeList` implemented: fetches GET /api/nodes, prints 4-column table (ID/TYPE/STATUS/LAST CLAIM), empty-state hint, formatRelativeTime helper.
  - [x] 7.2 Connection error → `townhouse hs up isn't running` and exit 1.
  - [x] 7.3 `--json` mode: emits API body verbatim (no `ok` envelope); errors emit `{ok:false,...}` to stdout only.

- [x] **Task 8: CLI dispatch implementation in `cli.ts` (AC: all)**
  - [x] 8.1 Imported handlers from `./cli/node-commands.js` at top of `cli.ts`.
  - [x] 8.2 `case 'node'` dispatches to `handleNodeAdd/Remove/List` with proper DI overrides forwarded.
  - [x] 8.3 `townhouse node` with no subcommand → `CliHelpRequested` with NODE_HELP.
  - [x] 8.4 Added `CliNodeCommandOverrides` interface and 5th param `nodeCommandOverrides` to `main()`.

- [x] **Task 9: CLI unit tests — `cli.node.test.ts` (AC: all)**
  - [x] 9.1 New file `packages/townhouse/src/cli.node.test.ts` — mirrors cli.hs.test.ts pattern.
  - [x] 9.2 All tests use `nodeCommandOverrides.fetch` DI hook (no vi.stubGlobal).
  - [x] 9.3 All 21 required test cases implemented and passing.
  - [x] 9.4 `pnpm --filter @toon-protocol/townhouse test cli.node` — 21/21 green.

- [x] **Task 10: Help-text test + smoke regression (AC: 7)**
  - [x] 10.1 Added regression test in `cli.test.ts`: asserts all three `townhouse node` lines are in help text.
  - [x] 10.2 `cli.hs.test.ts` still passes (22/22 green) — signature widening is backward compatible.

- [x] **Task 11: Resolve D4 + close out (AC: all)**
  - [x] 11.1 `TODO(46.3)` removed from `nodes-lifecycle.ts` (grep returns zero matches).
  - [x] 11.2 D4 resolution appended in `deferred-work.md`.
  - [x] 11.3 `pnpm --filter @toon-protocol/townhouse build` — clean.
  - [x] 11.4 `pnpm --filter @toon-protocol/townhouse test` — 932 passed, 11 pre-existing failures (logs + earnings), no new failures.
  - [x] 11.5 `pnpm lint` — no new errors (1 pre-existing error in nodes-yaml.ts not touched by this story).
  - [x] 11.6 sprint-status.yaml updated: `46-3-townhouse-node-add-remove-list-cli` → `review`.

## Dev Notes

### Story Scope — Two Hidden Asks Beyond the Literal AC

1. **`GET /api/nodes` is NEW work.** AC #5 says "the CLI calls `GET /api/nodes`" but 46.2 only shipped `POST` and `DELETE` at that path. The closest pre-existing endpoint is `GET /nodes` (no `/api` prefix, docker-status-driven, lives in `nodes.ts`) — that's the SPA's view and is intentionally distinct. This story must add a NEW yaml-driven `GET /api/nodes` that joins yaml entries with connector peer state. Place it in `nodes-lifecycle.ts` to keep `/api/nodes*` co-located.

2. **D4 from 46.2 review is resolved here.** 46.2's `TODO(46.3)` block comment (`nodes-lifecycle.ts:131-134`) deferred the `config.nodes[type].enabled` semantics question. The user-facing answer surfaces with this story's CLI verbs: HS-mode lazy provisioning makes `nodes.yaml` the source of truth, and the static `enabled` flag is **dev-profile only**. Document the decision and remove the TODO.

### Architectural Layering — Where Each Verb Lives

```
CLI (cli.ts)                         ← parseArgs, command switch, --help
   ↓ dispatch
node-commands.ts (NEW)               ← handleNodeAdd / Remove / List
   ↓ fetch()
HS host API (127.0.0.1:28090)        ← Fastify routes
   ↓
nodes-lifecycle.ts                   ← POST / DELETE / GET /api/nodes
   ↓
WalletManager / DockerOrchestrator / ConnectorAdminClient / nodes-yaml
```

The CLI is intentionally thin — no Docker, no wallet, no yaml. Everything goes through HTTP. This is the architectural rule that makes Epic 48's TUI possible (it consumes the same API surface).

### `GET /api/nodes` Response Shape (NEW endpoint)

```typescript
type GetNodesResponse = {
  nodes: Array<{
    id: string;
    type: 'town' | 'mill' | 'dvm';
    peerId: string;
    ilpAddress: string;
    status: 'connected' | 'disconnected' | 'unknown';
    enabledAt: string;       // ISO-8601 with offset
    lastSeenAt: string | null;
  }>;
};
```

- `nodes` is sourced from `readNodesYaml(nodesYamlPath).entries` (yaml is truth).
- `status` is computed by intersecting with `deps.connectorAdmin.getPeers()`:
  - peer.connected === true → `'connected'`
  - peer.connected === false → `'disconnected'`
  - no matching peer in connector list → `'disconnected'` (yaml entry awaiting reconciler heal)
  - `getPeers()` throws → ALL nodes get `status: 'unknown'` (connector unreachable); response still returns 200
- `lastSeenAt` echoes the yaml field. Epic 47 will populate it from earnings claims; until then it stays `null` (rendered as `—` in the CLI table).

**Do NOT expose `derivationIndex` on this endpoint** — it's an internal HD-wallet detail. The yaml has it; the API does not.

### CLI Progress UX — Stage Indicator, Not Real-Time Progress

The four stages (`Pulling image · Deriving wallet · Registering with apex · Live`) are **logical milestones**, not a streaming progress bar. The POST request is one blocking HTTP call; the server runs the full 6-step pipeline and returns 201 only at the end. The CLI cannot show per-step progress without SSE/streaming (out of scope).

UX shape:
1. CLI prints `· Pulling image · Deriving wallet · Registering with apex · Live` (all stages dim).
2. CLI awaits the POST response.
3. On 201 → re-print line with all stages `✓` green; print `Added <id> (<peerId>) at <ilpAddress>` on the next line.
4. On 4xx/5xx → print `✕ Step <step> failed: <err>` on a new line; render Sally's failure copy via `renderFailure()` if the step maps (pull-image, port-collision, missing-docker-sock).

This matches the user-facing AC #2 ("stages lighting up green as each completes") while honoring the protocol reality (single round-trip). Epic 48's TUI may later add SSE for real-time per-step glyph transitions.

### Stage Identifier Mapping (CLI → server `step` field)

The server's `step` field uses 46.2's six identifiers. The CLI groups them into the four user-visible stages:

| Server step (46.2)   | CLI stage label        |
|----------------------|------------------------|
| `derive-key`         | Deriving wallet        |
| `pull-image`         | Pulling image          |
| `write-yaml`         | (no label — too fast)  |
| `start-container`    | Registering with apex  |
| `healthcheck`        | Registering with apex  |
| `register-peer`      | Live                   |

`write-yaml` is grouped under "Deriving wallet" for display purposes when it fails (it's the same disk-class category from the operator's POV). `start-container` and `healthcheck` collapse into "Registering with apex" because they're both "spinning up the new peer." This mapping lives in a small `STEP_TO_STAGE` table at the top of `node-commands.ts`.

### Failure Copy — Reuse `renderFailure()`, Add One Optional Entry

`packages/townhouse/src/cli/failure-copy.ts` (Story 45.4) already has copy for `image-pull-failure`, `port-collision`, `missing-docker-sock`. Reuse these directly — when the `step` field is `'pull-image'`, construct a synthetic `Error` whose message contains `'failed to pull'` and pass to `renderFailure()`. The classifier already matches.

**Optional addition (UX-DR5 partial — "registration drift"):** if `register-peer` fails with the rollback succeeding cleanly, the system is back to byte-identical state (per 46.2 AC #3). This is NOT registration drift — it's a clean rollback. If `rollbackError` is non-empty in the response, **that** is registration drift and warrants a new entry. Decision: do NOT add a new copy entry in this story. Print `rollbackError` as plain text below the headline. The "registration drift" UX-DR5 copy entry is owned by Epic 48 (rendering when API is unreachable). Keep this story tight.

### `--json` Mode Discipline

`--json` is a contract with scripting consumers (CI runners, automation, future TUI). Rules (apply to all three verbs):

1. **Stdout is JSON only.** No human prose lines mixed in. No progress indicators. No `console.log("Pulling image...")`. Suppress them at function entry when `options.json === true`.
2. **Stderr is allowed but rare.** Fastify-style logging (already piped to stderr by `request.log.*`) is fine. Don't ADD stderr writes in `--json` mode beyond what the failure already emits.
3. **Exit code is the source of truth for success/failure.** `ok: true` in the body always corresponds to exit 0; `ok: false` always to exit 1. Scripts can branch on either.
4. **JSON is one line.** Use `JSON.stringify(obj)` not `JSON.stringify(obj, null, 2)`. Multi-line JSON breaks `| jq -r` chains.
5. **`node list --json` is the exception:** emit the API response body verbatim (no `ok` envelope). This is consistent with how `kubectl get -o json` works — the natural shape of a list endpoint is the list. Failures still get `{"ok": false, ...}`.

### Confirmation Prompt — Reuse `readline`, Don't Hand-Roll

`packages/townhouse/src/cli/password-prompt.ts` already uses `readline` for the wallet password (silent input mode). For the y/N confirmation, write a smaller helper:

```typescript
async function confirmInteractive(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
```

Tests stub it via the `nodeCommandOverrides.confirm` DI hook so they never block on real stdin.

### TTY Detection — Match `handleHsUp`'s Pattern

For non-TTY without `--yes`, mirror `handleHsUp` (`cli.ts:822-830`) which exits 1 with a clear message when the password prompt can't run. Same pattern, same error class.

```typescript
if (!options.yes && !process.stdin.isTTY) {
  console.error('--yes required when stdin is not a TTY (use --yes for non-interactive removal).');
  process.exitCode = 1;
  return;
}
```

### Existing Helpers This Story Reuses (do NOT reinvent)

- **`HS_TOWNHOUSE_API_URL`** at `cli.ts:757` — `'http://127.0.0.1:28090'`. Export this constant from `cli.ts` so `node-commands.ts` can import it (or duplicate the literal — the import is cleaner for testability). Tests override via `nodeCommandOverrides.apiUrl`.
- **`renderFailure(error)`** at `cli/failure-copy.ts:131` — Sally's three-line failure copy. Reuse for pull/port/docker errors.
- **`useAscii()`** at `cli/failure-copy.ts:59-63` — TTY/Unicode detection. Either export and reuse, or duplicate the 12 lines (it's tiny — duplication is fine, just don't drift).
- **`promptPassword(question)`** at `cli/password-prompt.ts` — pattern reference for the y/N prompt. Don't reuse directly (it does silent-input which is wrong for y/N).
- **`CliHelpRequested`** class at `cli.ts:65` — throw for help-text exits, caught by the top-level invoker for clean exit 0.
- **`parseArgs` options table** at `cli.ts:1200-1220` — add new flags (`--yes`, `--json`) here, not in a parallel parser.
- **`readNodesYaml` / `writeNodesYaml`** at `state/nodes-yaml.ts` — read-only in this story; do NOT mutate the yaml from CLI handlers (the host API owns mutation).
- **`deps.connectorAdmin.getPeers()`** at `connector/admin-client.ts` — used by the new `GET /api/nodes` handler to join yaml with connector state.

### NEW Methods / Files This Story Adds

- **`packages/townhouse/src/cli/node-commands.ts`** — handlers for `add`, `remove`, `list` + helpers (`confirmInteractive`, `printStageProgress`, `formatRelativeTime`, `STEP_TO_STAGE` table).
- **`packages/townhouse/src/cli.node.test.ts`** — vitest test file for the three handlers (mirror `cli.hs.test.ts` shape).
- **`packages/townhouse/src/api/routes/nodes-lifecycle.ts`** — ADD `app.get('/api/nodes', handler)` route (yaml-driven list). Tests in the same `nodes-lifecycle.test.ts` file.
- **`packages/townhouse/src/cli.ts`** — add `case 'node'` to switch, extend `HELP_TEXT`, extend `parseArgs` options, widen `main()` signature with optional `nodeCommandOverrides`.

### Files Modified

- **`packages/townhouse/src/cli.ts`** — see above.
- **`packages/townhouse/src/api/routes/nodes-lifecycle.ts`** — add `GET /api/nodes`; remove `TODO(46.3)` comment.
- **`packages/townhouse/src/api/routes/nodes-lifecycle.test.ts`** — add 5 GET tests.
- **`_bmad-output/implementation-artifacts/deferred-work.md`** — append "Resolved" line under D4 entry.
- **`packages/townhouse/src/cli.test.ts`** — add help-text regression test (Task 10.1).

### Files Read but NOT Modified

- `packages/townhouse/src/api/routes/nodes-lifecycle.ts` — read all 700-ish lines before touching. Understand: response shapes for POST/DELETE error vs. success, the `step` field literal values, mutex semantics (409 `node_lifecycle_in_flight`).
- `packages/townhouse/src/api/routes/nodes.ts` lines 113-156 — confirm `GET /nodes` is the SPA path (no `/api` prefix, docker-status-driven). The new `GET /api/nodes` is yaml-driven and orthogonal — do NOT merge them.
- `packages/townhouse/src/state/nodes-yaml.ts` — confirm field names (`id`, `peerId`, `lastSeenAt`).
- `packages/townhouse/src/cli/failure-copy.ts` — reuse `renderFailure`, `useAscii`.
- `packages/townhouse/src/cli/password-prompt.ts` — pattern reference for readline-based prompt.
- `packages/townhouse/src/cli.hs.test.ts` — test fixture pattern reference.

### Previous Story Intelligence (46.1 + 46.2)

- **D4 deferred to this story:** static `nodes.<type>.enabled` vs. lifecycle-add. Resolution: HS-mode = yaml is truth, static flag = dev-profile only. Tracked in deferred-work.md (line 263).
- **Step identifiers (46.2):** `derive-key`, `pull-image`, `write-yaml`, `start-container`, `healthcheck`, `register-peer` (POST); `deregister-peer`, `stop-container`, `remove-yaml` (DELETE). CLI maps these to user-visible stages via `STEP_TO_STAGE`.
- **`rollbackError` field in error response (P6 patch in 46.2):** present when rollback itself fails. CLI surfaces it as plain text below the headline. Do NOT treat as a second error class.
- **`node_type_in_use` 409:** v1 single-instance-per-type constraint. CLI prints `Node of type '<type>' already exists with id '<existingId>'. Remove it first or use a different type.`
- **`node_lifecycle_in_flight` 409:** concurrent POST/DELETE serialization (mutex). CLI prints `Another node operation is in flight. Try again in a moment.`
- **Pino redact paths in `build-app.ts`:** cover `mnemonic`, `password`, `nostrSecretKey`, `evmPrivateKey`, `TOWN_SECRET_KEY`, etc. The CLI does NOT receive these in API responses (verified: response bodies are `{id, type, peerId, ilpAddress, hsRoute, healthCheckUrl}` only — no secrets). No new redaction needed in this story.

### Connector Endpoint References (NOT touched, but consumed)

- `GET /admin/peers` (existing, via `deps.connectorAdmin.getPeers()`) — used by the new `GET /api/nodes` handler.
- Connector errors are non-fatal: `getPeers()` throws on connection refused → `GET /api/nodes` returns `status: 'unknown'` for all nodes; 200 OK still.

### Scope Guards — What This Story Does NOT Touch

- **No Epic 47 earnings.** `lastSeenAt` returns `null` until Epic 47 wires the earnings claim updates. CLI renders `—` for null. Do NOT pre-emptively wire earnings here.
- **No Epic 48 TUI.** The CLI emits plain text tables, not Ink-rendered TUIs. Future TUI work consumes the same API surface.
- **No streaming/SSE.** The four-stage progress is a logical milestone display, not real-time. SSE is a future enhancement (out of scope).
- **No registration-drift copy entry.** The "drift" case is owned by Epic 48 (rendering when API is unreachable). This story prints `rollbackError` as plain text below the headline.
- **No multi-instance support.** v1 enforces single-instance-per-type at the API layer (409). CLI surfaces the 409 cleanly; no client-side multi-instance handling.
- **No `townhouse node start/stop` verbs.** Lifecycle is add/remove only. Start/stop without provisioning churn is a future story (likely Epic 47+ when operators want to pause-without-delete).
- **No connector-config edits via CLI.** Operator-defined routes / BTP URLs / fee patches stay on the existing PATCH route. `node` is provisioning only.
- **No `--type` short flag.** The type is a positional (`node add town`), not a flag. Keeps the CLI vocabulary close to Docker (`docker run <image>`) and matches the AC literally.
- **No `townhouse node <verb> --output yaml`.** Two formats (human + JSON) is enough.

### Test Strategy Notes

- **No real Docker, no real network.** All tests stub `fetch` via DI.
- **No real wallet decryption.** The fixture creates a temp wallet but tests never invoke the wallet handlers — they go through HTTP (stubbed).
- **`process.exitCode` is the assertion target** for success/failure (mirror `cli.hs.test.ts`). Don't assert on `process.exit()` because the `main()` wrapper handles that.
- **`process.stdin.isTTY` shim** is set/restored in `beforeEach`/`afterEach` (see `cli.hs.test.ts:181-216`).
- **`renderFailure()` is stubbed** in tests that assert the failure path — verify the classifier was called with the right error class, don't assert on the exact rendered text (the text is owned by `failure-copy.test.ts`).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `GET /api/nodes` (NEW yaml-driven endpoint) in `nodes-lifecycle.ts` before POST. Handler joins nodes.yaml entries with connector peer state (`getPeers()`); degrades gracefully to `status:'unknown'` when connector is unreachable (never 500s on connector-down).
- Resolved D4 decision: HS-mode nodes.yaml is the single source of truth; `config.nodes[type].enabled` is dev-profile only. `TODO(46.3)` removed. Documented in `node-commands.ts` block comment and `deferred-work.md`.
- Created `cli/node-commands.ts` with `handleNodeAdd`, `handleNodeRemove`, `handleNodeList` handlers; `confirmInteractive`, `formatRelativeTime`, `STEP_TO_STAGE` helpers; `NODE_HELP`, `NODE_ADD_HELP` constants.
- Exported `useAscii` from `failure-copy.ts` so it can be shared with node-commands.
- Updated `cli.ts`: added `json` to parseArgs, added `CliNodeCommandOverrides` interface, widened `main()` signature (5th param), added `case 'node'` dispatch, node sub-help detection before global `--help` check, updated `HELP_TEXT` with three node verb lines.
- Updated `MockConnectorAdminClient` in `nodes-lifecycle.test.ts` to use async `getPeersFn: Mock` for configurable `getPeers()` response; fixed 3 existing test assertions to `await connectorAdmin.getPeers()`.
- All tests: 932 passed (21 new node CLI + 5 new GET API + 1 new help regression), 11 pre-existing failures unchanged (logs.test.ts + earnings.test.ts — orthogonal scope).

### File List

- `packages/townhouse/src/api/routes/nodes-lifecycle.ts` — added `GET /api/nodes` route; removed `TODO(46.3)` comment
- `packages/townhouse/src/api/routes/nodes-lifecycle.test.ts` — updated `MockConnectorAdminClient.getPeers` to async mock; fixed 3 `await` assertions; added 5 GET tests
- `packages/townhouse/src/cli/node-commands.ts` — NEW: three node handlers + helpers
- `packages/townhouse/src/cli/failure-copy.ts` — exported `useAscii`
- `packages/townhouse/src/cli.ts` — `json` parseArgs option; `CliNodeCommandOverrides` type; 5th param on `main()`; `case 'node'` dispatch; node sub-help before global help; updated `HELP_TEXT`
- `packages/townhouse/src/cli.node.test.ts` — NEW: 21 CLI node tests
- `packages/townhouse/src/cli.test.ts` — added help text regression test (3 node verb lines)
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended D4 resolution
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status → review

### Review Findings

_Code review 2026-05-11 — 7 patches applied, 10 deferred, 20 dismissed (Blind Hunter + Edge Case Hunter + Acceptance Auditor). AC #1-#7 all met; no blockers. Post-patch: 944 tests passing (was 932; +12 new); 11 pre-existing failures unchanged (logs + earnings, orthogonal scope); 1 pre-existing lint error unchanged (nodes-yaml.ts, untouched)._

- [x] [Review][Patch] Wire `NODE_REMOVE_HELP` and `NODE_LIST_HELP` into sub-help dispatcher [`cli.ts:1247-1252`] — currently `node remove --help` and `node list --help` show generic `NODE_HELP`; verb-specific helps are exported but never imported (dead code).
- [x] [Review][Patch] Guard `response.json()` on add/remove paths [`cli/node-commands.ts` POST/DELETE success and error branches] — empty/non-JSON body throws SyntaxError that escapes the handler with no exit code or friendly message. Mirror `handleNodeList`'s `.catch(() => ({}))` pattern.
- [x] [Review][Patch] `formatRelativeTime` rejects invalid ISO [`cli/node-commands.ts` formatRelativeTime helper] — `new Date(invalid).getTime()` returns NaN; arithmetic falls through to "NaNd ago". Add `Number.isNaN(time)` guard returning `'—'`.
- [x] [Review][Patch] Column header `ID` → `peer` to match AC #5 literal [`cli/node-commands.ts` printTable / header constants] — spec AC #5 specifies columns `peer · type · status · last claim`; implementation prints `ID  TYPE  STATUS  LAST CLAIM`.
- [x] [Review][Patch] Stop polluting `process.stdin.isTTY` for downstream tests [`cli.node.test.ts:73-80`] — when original value is `undefined`, the redefined writable property replaces the original `tty.ReadStream` accessor for all subsequent tests in the same vitest worker. Capture and restore the property descriptor instead.
- [x] [Review][Patch] Avoid silent column truncation in `printTable` [`cli/node-commands.ts:496-512`] — `pad('long-id', 10)` slices without ellipsis. Compute widths from content (or cap with `…`) so long IDs / peer handles don't drop data.
- [x] [Review][Patch] Add coverage for unguarded branches [`cli.node.test.ts`] — bundle: 409 `node_lifecycle_in_flight` on add AND remove, `node add foo` (invalid type), `node list` 5xx, AbortError/timeout on all three verbs, `formatRelativeTime` with populated `lastSeenAt`. +12 tests; suite: 33/33 green.
- [x] [Review][Defer] `getPeers()` error classification — any throw maps to `connectorUnreachable: true`, masking TLS/auth/parse failures [`api/routes/nodes-lifecycle.ts:148-156`] — deferred, refinement.
- [x] [Review][Defer] `AbortController` not torn down on success path [`cli/node-commands.ts` fetch sites] — deferred, minor signal-listener leak per call.
- [x] [Review][Defer] No SIGINT cleanup during `confirmInteractive` [`cli/node-commands.ts` readline prompt] — deferred, readline holds stdin raw mode if Ctrl-C races `rl.close()`.
- [x] [Review][Defer] Unbounded id length passes regex client-side [`cli/node-commands.ts` NODE_ID_PATTERN] — deferred, server-side fetch rejects but no client cap.
- [x] [Review][Defer] ANSI/control-char passthrough in server-supplied `body.err` printed to stderr [`cli/node-commands.ts` error rendering] — deferred, local trusted but inconsistent with other CLI sanitization.
- [x] [Review][Defer] yaml-read 500 leaks filesystem path to API consumer [`api/routes/nodes-lifecycle.ts:135-141`] — deferred, hardening pass.
- [x] [Review][Defer] `'disconnected'` collapses missing-peer and mid-handshake states [`api/routes/nodes-lifecycle.ts:160-164`] — deferred, Epic 47/48 concern.
- [x] [Review][Defer] `parseArgs({ strict: false })` silently swallows long-flag typos [`cli.ts:1230`] — deferred, pre-existing CLI-wide pattern.
- [x] [Review][Defer] DELETE-id regex duplicated client-side without shared constant [`cli/node-commands.ts` NODE_ID_PATTERN vs route schema] — deferred, drift risk if server pattern changes.
- [x] [Review][Defer] STAGE_LABELS visual order (`Pulling → Deriving → Registering → Live`) doesn't match server pipeline order (derive-key first) [`cli/node-commands.ts` STAGE_LABELS] — deferred, minor UX surprise.

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section
- [x] Does this story contain regex or template substitution logic? The DELETE-id sanitization regex `^[a-z][a-z0-9-]*$` is pre-validated client-side. At least one unit test must pass a realistic uppercase or hyphen-prefixed id (e.g., `Town-01`, `-mill`, `town_01`) — not just synthetic single-char inputs
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? If yes, those tests must be un-gated and run before marking this story done, OR have a comment: `// Gate: <condition>. Run before marking story done.`
- [x] Verify the D4 resolution is documented BOTH in `cli/node-commands.ts` block comment AND in `deferred-work.md` (line 263 entry appended)
- [x] Verify the `TODO(46.3)` comment at `nodes-lifecycle.ts:131-134` has been removed (grep `TODO(46.3)` on the package — should return zero matches)
- [x] Verify `--json` mode emits ONLY JSON to stdout (no human prose) for all three verbs — at least one test per verb must assert this
- [x] Verify help text contains the literal substring `townhouse node add mill   # earn from chain swaps (5x earnings unlock)` (AC #7)
- [ ] Update sprint-status to `done` (with PR number in trailing comment)
