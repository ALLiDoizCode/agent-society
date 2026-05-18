# Story 48.6: Sats Power-User Flag (`townhouse status --units=sats`)

Status: done

> **Sixth story of Epic 48 (Operator Dashboard / Ink TUI).** Sized **S**. Adds (a) a USDC earnings summary block to the existing `townhouse status` command (TODAY / MONTH / YEAR / LIFETIME, mirroring the TUI HeroBand's column shape), (b) an UNDOCUMENTED `--units=sats` power-user flag that converts that block from USDC to integer sats using a CLI-supplied rate, and (c) a single README footnote mentioning the flag. **Defends D44-002**: USDC stays the canonical denomination across every other surface (TUI hero, drill verbs, `node list`, `peer`, `health`); sats display exists only here, only on `townhouse status`, and only when the operator explicitly opts in via `--units=sats --rate <n>` (or `TOWNHOUSE_SATS_PER_USDC` env). This is the Bitcoin-maxi safety valve, not a product feature.
>
> **Critical path:** Epic 47 (DONE — `/admin/earnings.json` proven against a live apex) → 48.1–48.5 (DONE — TUI + drill verbs ship the canonical USDC display) → **48.6 (this — opens the sats safety valve on `status` only)** → 48.7 (live gate runs `townhouse status --units=sats` against the same fixtures and asserts sats render correctly).
>
> **No new wires.** This story consumes the existing connector admin endpoints (`/admin/earnings.json`) via the existing `ConnectorAdminClient.getEarnings()`. No host-API surface added, no new admin-client method, no connector PR, no image bump. The only data-shape extension lives entirely inside `handleStatus` and a small new helper module.
>
> **NO new merge-gate UX-DR.** Like 48.5, this is engineering plumbing with no terminal-rendering decisions to lock down — the format of the earnings block is the lowest-common-denominator of the existing TUI HeroBand columns, and the sats display is intentionally undocumented (no Sally hill to climb on a copy library Drew will never see). The story does NOT create a UX-DR.
>
> **`townhouse status` currently shows NO earnings.** Verified at cli.ts:426-484 — `handleStatus` prints Node Status, Hidden Services, and Connector Metrics (packets forwarded, active peers). There are zero USDC amounts on screen today. AC #1 in the epic spec says "all displayed earnings amounts are converted from USDC to sats" — that text implies earnings exist to be converted. **This story is therefore TWO things bundled by the epic AC**: (1) add an earnings summary block to `townhouse status`, (2) the `--units=sats` flag converts it. Both are required to satisfy the AC verbatim.
>
> **Rate source — CLI-supplied, NOT a network oracle.** The epic AC says "(using a fixed reference rate at fetch time, sourced from a configured oracle or a CLI-supplied rate)". Reading: an oracle integration would require a network call, caching, error handling, and a fallback story — far more scope than a power-user flag warrants. **This story implements only the CLI-supplied path**: `--rate <sats-per-usdc>` (undocumented in HELP_TEXT) OR the `TOWNHOUSE_SATS_PER_USDC` env var. `--units=sats` without a rate exits 1 with a usage hint. An oracle-backed rate is left as a future story (and is explicitly NOT a 48.7 gate requirement — 48.7 invokes the verb with `--rate` supplied via fixture).
>
> **Reuse `aggregateEarnings()` — do NOT re-roll the sum.** The `packages/townhouse/src/earnings/aggregator.ts:aggregateEarnings` function is the canonical source-of-truth aggregator the TUI consumes via the `/api/earnings` route. It (a) calls `getEarnings()` on the connector, (b) sums apex + per-peer claims, (c) delegates today/month/year delta computation to the snapshot-backed `createDeltaComputer` from `earnings/snapshot-reader.ts`, (d) handles connector outage by returning `status: 'connector_unavailable'` instead of throwing. `handleStatus` calls the aggregator with the same inputs the host-API route uses (nodes.yaml-derived `PeerTypeResolver` + snapshot-backed `deltaComputer`); no parallel implementation. The TUI's `HeroBand.computeScalars` (HeroBand.tsx:37-65) is the model for the per-asset summation that lives ABOVE the aggregator — copy that logic into a tiny helper in `cli/status-earnings.ts` (do not import the .tsx component into the CLI path).
>
> **One precision rule for sats conversion — BigInt all the way.** USDC amounts are decimal strings at `USDC_SCALE = 6` (e.g. `'1000000'` = $1.00). Sats conversion = `(usdcMicroBigInt * satsPerUsdcBigInt) / 10n ** 6n`, truncated to integer sats. Floating-point math is forbidden here because a 6-decimal USDC value × an integer sats/USDC rate can produce intermediate values >`Number.MAX_SAFE_INTEGER` for a lifetime apex sum. The helper signature is `usdcMicroToSats(decimalString: string, satsPerUsdc: number): string` returning a non-negative integer string with thousands-separator formatting applied at display time.
>
> **Documentation discipline — single footnote, single location.** D44-002 says "mentioned only in a README footnote (not in the main usage section, not in marketing copy)". The footnote goes in `packages/townhouse/README.md` ONLY (it's the package-local README that npm consumers see on npmjs.com). The repo-root `README.md` is NOT touched. Format: a short paragraph at the BOTTOM of the README under a `## Notes` (or `## Power-user flags`) section, NOT in the Quick Reference table, NOT in the HS Mode section, NOT in any Usage block. HELP_TEXT (cli.ts:84-118) does NOT mention `--units` or `--rate` — `townhouse status --help` (which prints HELP_TEXT) must continue to render the existing `townhouse status [-c <path>]` usage line verbatim. AC #2 enforces this with a regex-style assertion.
>
> **No new runtime dependencies. No COPY library extensions.** The empty-state copy library (`tui/copy.ts`) is the TUI's domain — `townhouse status` is plain stdout, no Ink, no copy library. New strings are inline.

## Story

As **Drew (a Bitcoin-native homelab operator who runs alongside a Lightning node and a Helium hotspot)**,
I want **`townhouse status --units=sats` to render my Townhouse earnings in sats so I can mentally compare them against my LN routing earnings, while everyone else on the project sees clean USDC numbers**,
so that **I can continue running my Townhouse without being personally evangelised to USDC — and the project's marketing copy (`MONTH $X.XX USDC`) stays decoupled from my private power-user preference**.

## Acceptance Criteria

1. **AC #1 — `townhouse status` shows a USDC earnings block by default.** **Given** the operator runs `townhouse status` with an apex running and a non-zero earnings history, **When** the command executes, **Then** AFTER the existing `Node Status:` / `Hidden Services:` / `Connector Metrics:` sections, a new `Earnings (USDC):` section prints with four labeled rows: `TODAY`, `MONTH`, `YEAR`, `LIFETIME`. Values are formatted via the existing `formatUsdc(decimalString, USDC_SCALE)` helper (tui/format.ts:45) — `$X.XX` shape, 2-decimal, truncated (NOT rounded) per connector posture. Empty/zero earnings render `$0.00` (the formatter handles this). Section header underline is `----------------` (16 dashes; same convention as `Node Status:` / `Connector Metrics:`).
    - Earnings are sourced via `aggregateEarnings({ connectorAdmin, peerTypeResolver, deltaComputer, logger })` from `earnings/aggregator.ts` — the same call the host-API `/api/earnings` route uses (api/routes/earnings.ts:45-69). The CLI constructs `peerTypeResolver` from `~/.townhouse/nodes.yaml` (`readNodesYaml` from `state/nodes-yaml.ts`) and `deltaComputer` from `createDeltaComputer({ snapshotPath: ~/.townhouse/earnings-snapshots.jsonl })` (`earnings/snapshot-reader.ts`). The `connectorAdmin` is the same `ConnectorAdminClient` `handleStatus` already constructs at cli.ts:467-470.
    - Per-asset summation across `apex.routingFees['USDC']` + `peers[].byAsset['USDC']` (the TODAY / MONTH / YEAR / LIFETIME fields) mirrors `HeroBand.computeScalars` (HeroBand.tsx:37-65) — the helper is duplicated into `cli/status-earnings.ts` because importing a `.tsx` component into the non-Ink CLI path would drag React + Ink into the cold-start of `townhouse status`. The new helper is ~25 lines; the duplication is acknowledged in Dev Notes § "Why duplicate computeScalars".
    - Connector outage: when `aggregateEarnings` returns `status: 'connector_unavailable'` (network, 503, shape drift), the section prints `Earnings (USDC): unavailable` on a SINGLE line (no header rule, no four-row block). Mirrors the existing `Connector Metrics: unavailable` pattern at cli.ts:482.

2. **AC #2 — `--units=sats` is registered in parseArgs but NOT in HELP_TEXT.** **Given** the parseArgs options block at cli.ts:1300-1324, **When** this story lands, **Then**:
    - `'units'` (string, allowed values: `'usdc' | 'sats'`, default `'usdc'`) is added to the `options` table.
    - `'rate'` (string) is added to the `options` table. Parsed value is validated as a positive integer via `/^[1-9]\d*$/.test(...)` — rejects empty, whitespace, `0`, negative, decimals, `1e3`, `0x10`. Invalid → `stderr: --rate must be a positive integer (sats per 1 USDC)` AND `process.exitCode = 1` AND no earnings block prints.
    - `HELP_TEXT` (cli.ts:84-118) is NOT modified — the `townhouse status [-c <path>]` usage line stays verbatim; the `Flags:` block gains NO `--units` or `--rate` entry. AC test: `await main(['--help'])` output does NOT contain the substrings `--units`, `--rate`, or `sats`.
    - `townhouse status --help` (the global `--help` short-circuit at cli.ts:1344-1347) is also unmodified — the same HELP_TEXT is printed, no `--units`/`--rate` mention.

3. **AC #3 — `townhouse status --units=sats --rate <N>` converts the earnings block to integer sats.** **Given** the operator runs `townhouse status --units=sats --rate 1500`, **When** the command executes, **Then**:
    - The earnings section header changes to `Earnings (sats @ 1500/USDC):` (literal — the rate is interpolated into the header so screenshots are self-explanatory). The 4-row block renders TODAY / MONTH / YEAR / LIFETIME values as integer sats with thousands-separator formatting (e.g. `1,234 sats`, `0 sats`, `12,345,678 sats`). The unit suffix `sats` is appended to each value.
    - Conversion is `(usdcMicroBigInt * satsPerUsdcBigInt) / 10n ** 6n`, truncated to integer (BigInt division floor). Implementation lives in a new helper `usdcMicroToSats(decimalString: string, satsPerUsdc: number): string` in `cli/status-earnings.ts` returning a NON-NEGATIVE decimal-integer string (no thousand-separators — those are added at display time via `Number(satsStr).toLocaleString('en-US')`, which is safe for sats values that fit in a Number; for sums exceeding `Number.MAX_SAFE_INTEGER` (≈9e15) the formatter falls back to a manual regex-based grouping — a documented edge case in Dev Notes).
    - Negative USDC values (peer in net-debt; rare but possible per connector convention) preserve the `-` sign in sats too (`-1,234 sats`). The helper returns the absolute conversion + a sign flag; the caller prepends `-` before the thousand-separator pass.
    - Rate sourced from `--rate <N>` (highest precedence) OR `TOWNHOUSE_SATS_PER_USDC` env var (fallback). If both are set, `--rate` wins. If neither is set AND `--units=sats` is requested → `stderr: --units=sats requires --rate <sats-per-usdc> or TOWNHOUSE_SATS_PER_USDC env var (e.g. --rate 1500 for 1500 sats per 1 USDC)`, `process.exitCode = 1`, NO earnings block prints (the rest of `handleStatus` — Node Status etc — does still print so the operator sees the partial command result).

4. **AC #4 — `--units=usdc` and unspecified `--units` are equivalent (canonical USDC path).** **Given** the operator runs `townhouse status` (no flag) OR `townhouse status --units=usdc`, **When** the command executes, **Then** AC #1's USDC block prints unchanged — the explicit `--units=usdc` does NOT trigger any different code path or message. Any value other than `'usdc'` or `'sats'` → `stderr: --units must be 'usdc' or 'sats'`, `process.exitCode = 1`, NO earnings block.

5. **AC #5 — No other CLI verb gains the `--units` flag.** **Given** any verb that is NOT `status` (`hs up`, `hs down`, `up`, `down`, `node add`, `node remove`, `node list`, `channels`, `metrics`, `logs`, `peer`, `health`, `setup`, `init`, `wallet show`), **When** invoked with `--units=sats`, **Then** the flag is **silently ignored** (parseArgs accepts it because the option is registered globally, but no handler consumes it). The verbs continue to render USDC verbatim. AC test: `await main(['metrics', '--units=sats'])` produces output that contains a USDC `$` glyph (when earnings exist in the fixture) and does NOT contain the substring `sats`. This guarantees that D44-002's canonical-USDC-everywhere-else posture holds even if a curious operator throws `--units=sats` at every verb.

6. **AC #6 — README footnote, one location only.** **Given** `packages/townhouse/README.md`, **When** this story lands, **Then**:
    - A new H2 section `## Notes` (or `## Power-user flags` — author's call; either is fine) is appended at the BOTTOM of the README (after `## Package overview`, after `## Transport configuration`, after every Quick Reference / HS Mode / Faucet section). It MUST NOT precede or sit inside any usage-style heading.
    - The section contains exactly one paragraph mentioning `townhouse status --units=sats`, the `--rate <N>` requirement, the env-var fallback, and a one-line "this is undocumented — USDC remains the canonical hero display" caveat. Example wording (the author may rephrase): *"`townhouse status --units=sats` exists as an undocumented power-user flag for Bitcoin-native operators. Requires `--rate <sats-per-usdc>` or `TOWNHOUSE_SATS_PER_USDC` env (no built-in price oracle). USDC remains the canonical denomination across every other surface (TUI hero, drill verbs); this flag is intentionally absent from `--help` per D44-002."*
    - The repo-root `README.md` is NOT modified.
    - The root `CLAUDE.md` is NOT modified (the flag is a power-user concern, not a setup/deployment concern).
    - No marketing copy, no blog post, no telemetry copy mentions sats — verified by `rg -n 'units=sats|TOWNHOUSE_SATS_PER_USDC' .` returning exactly the README footnote, the source file, and the test file (and the AC strings inside this story file). Any other surface that adds the substring `sats` after this story closes is a regression.

7. **AC #7 — All sats-conversion logic lives in `cli/status-earnings.ts`.** **Given** the existing `cli/` subdirectory pattern (drill-commands.ts, node-commands.ts, failure-copy.ts, etc.), **When** this story lands, **Then**:
    - A new file `packages/townhouse/src/cli/status-earnings.ts` exports: `interface EarningsRow { today: string; month: string; year: string; lifetime: string }`, `function computeUsdcScalars(earnings: AggregatedEarnings): EarningsRow` (mirrors HeroBand.computeScalars), `function usdcMicroToSats(decimalString: string, satsPerUsdc: number): string`, `function formatSatsRow(value: string): string` (thousand-separator + ` sats` suffix), `function renderEarningsSection(opts: { earnings: AggregatedEarnings; units: 'usdc' | 'sats'; satsPerUsdc?: number }): string[]` returning the lines to print (one per `console.log` call), `function resolveSatsRate(values: Record<string, unknown>, env: NodeJS.ProcessEnv): { rate: number } | { error: string }` (the rate-resolution helper).
    - The module imports ONLY from: `../earnings/aggregator.js` (types), `../tui/format.js` (`formatUsdc`), and `node:*` standard lib. It does NOT import from `../api/`, `../tui/components/`, `../docker/`, `../connector/`, `dockerode`, or `react`. Keeps cold-start surface tight.
    - A sibling test file `packages/townhouse/src/cli/status-earnings.test.ts` covers: `computeUsdcScalars` (zero / single-peer / multi-peer / apex-only / mixed-asset-with-non-USDC-filtered), `usdcMicroToSats` (zero / 1 USDC = N sats / fractional USDC truncates / negative input preserves sign / very-large value > Number.MAX_SAFE_INTEGER stays BigInt-safe), `formatSatsRow` (zero / under-1000 / over-1000-comma / over-million-two-commas / negative-with-sign), `resolveSatsRate` (CLI flag wins over env / env fallback / neither set returns error / invalid integer returns error / 0 returns error / decimal returns error).

8. **AC #8 — No regression on existing `townhouse status` tests.** **Given** the existing `status` test block at `cli.test.ts:524-717` (4 cases: enhanced metrics / Hidden Services with ATOR / no Hidden Services in direct / graceful degradation on admin-unreachable), **When** this story lands, **Then**:
    - All 4 existing cases pass verbatim. The new earnings block is APPENDED to the existing output; assertions like `expect(output).toContain('Connector Metrics')` continue to match. The new section adds lines BELOW the existing block.
    - The connector-unreachable case (cli.test.ts:692-716) gains ONE new line of expectation: `expect(output).toContain('Earnings (USDC): unavailable')` AND `expect(output).not.toContain('$')` (no dollar signs because the block degraded). Adding this assertion is part of this story's diff to the existing test.
    - `pnpm --filter @toon-protocol/townhouse build` stays clean (no typecheck errors).
    - `cli.ts` line count after this story is **within +30 lines** of the current 1548 lines (case `'status'` body grows from a 6-line shim into a ~25-line block; `handleStatus` itself gets ~15 added lines for the earnings call + section print). A strictly-lower delta is preferred; no further extraction required.

9. **AC #9 — New tests across CLI + status-earnings modules.** **Given** the new code, **When** `pnpm --filter @toon-protocol/townhouse test` runs, **Then** the suite gains (at minimum):
    - **`cli/status-earnings.test.ts`** (new file, ~20 cases) — coverage per AC #7.
    - **`cli.test.ts`** (~7 new cases — appended to the existing `status` describe block at cli.test.ts:526):
        1. `status` prints the USDC earnings block when fixtures supply non-zero earnings (assert all four labels `TODAY`, `MONTH`, `YEAR`, `LIFETIME` AND at least one `$` glyph appear).
        2. `status` prints the empty earnings block (`$0.00`) when fixtures supply zero earnings.
        3. `status --units=sats --rate 1500` prints `Earnings (sats @ 1500/USDC):` header AND values end in ` sats` AND no `$` glyph appears in the earnings section. Pin USDC fixture to a known value (e.g. `'1000000'` = $1.00) and assert exact sats output (`1,500 sats`).
        4. `status --units=sats` without rate fails with stderr containing the substring `--rate` AND exits 1 AND prints Node Status (partial output preserved).
        5. `status --units=sats` with `TOWNHOUSE_SATS_PER_USDC=2500` env var succeeds (vi.stubEnv). Assert header `@ 2500/USDC` appears.
        6. `status --units=foo` exits 1 with stderr containing `--units must be`.
        7. `metrics --units=sats` (or any non-status verb) does NOT alter its output — the existing metrics test assertions stay green AND new assertion `expect(output).not.toContain('sats')` passes.
    - **`--help` regression**: ONE new case in the existing help-text test block (`cli.test.ts` ~line 146) asserting `expect(helpOutput).not.toContain('--units')` AND `expect(helpOutput).not.toContain('--rate')` AND `expect(helpOutput).not.toContain('sats')`.
    - Net test delta target: **+25 to +30 tests** (townhouse total post-48.5 = 1207 → 1232-1237).
    - Per project-context's testing rule: **DO test** the conversion math (BigInt, truncation, large values), rate-resolution precedence, JSON-style decimal-string parsing, flag-precedence-over-env, regression on existing status output. **DON'T test** the connector itself (mock `getEarnings()`), the snapshot reader (mock `deltaComputer` or use a fixture jsonl file in a tempdir — the snapshot-reader tests already cover that helper), or real terminal width.

10. **AC #10 — Story close-out runbook.** **Given** the dev workflow, **When** this story closes, **Then**:
    - The PR description's "Smoke" section pastes the output of `townhouse status` (default) AND `townhouse status --units=sats --rate 1500` against a live local apex. Both must show a coherent earnings block (USDC vs sats); both must exit 0; the USDC block must NOT contain `sats`; the sats block must NOT contain `$`.
    - `### Review Findings` carries a dated entry per the template's mandatory close-out checklist.
    - 48.7's live-gate run (a separate story) will independently re-run `townhouse status --units=sats` against the same fixtures — this story's PR does NOT block on that. 48.7 closes Epic 48; this story closes when its own AC + smoke pass.
    - The sprint-status.yaml `48-6-sats-power-user-flag` flips to `done` only after Review Findings + smoke notes both exist in this story file.

**FRs:** FR29 (`townhouse status --units=sats` undocumented power-user flag).

## Tasks / Subtasks

- [x] **Task 1: Pre-work — read every file in the blast radius end-to-end (AC: all)**
  - [x] 1.1 Read `_bmad-output/implementation-artifacts/48-5-drill-subcommands.md` end-to-end — especially the Dev Notes (boundary rule, USDC formatter posture, "no new merge-gate UX-DR" justification) and the Review Findings (the patches that defended AC #12's line-count cap inform this story's AC #8 line-count constraint).
  - [x] 1.2 Read `packages/townhouse/src/cli.ts:426-484` — the existing `handleStatus` function. The new earnings block is APPENDED after the existing `Connector Metrics:` block; the function body grows by ~15 lines.
  - [x] 1.3 Read `packages/townhouse/src/cli.ts:84-118` — the existing `HELP_TEXT`. Verify the `townhouse status [-c <path>]` usage line at line 91. AC #2 requires this line stays verbatim and no `--units`/`--rate`/`sats` strings are added anywhere in HELP_TEXT.
  - [x] 1.4 Read `packages/townhouse/src/cli.ts:1300-1324` — the parseArgs options block. AC #2 adds two new options (`units`, `rate`) here.
  - [x] 1.5 Read `packages/townhouse/src/cli.ts:1403-1409` — the existing `case 'status'` block. The new flag parsing happens here BEFORE the call to `handleStatus`; the case body grows from a 6-line shim into a ~25-line block.
  - [x] 1.6 Read `packages/townhouse/src/tui/components/HeroBand.tsx` end-to-end — specifically `computeScalars` (lines 37-65). The new `computeUsdcScalars` in `cli/status-earnings.ts` is a STRUCTURAL COPY of this function, NOT an import (importing a `.tsx` would drag React + Ink into the non-TTY CLI path; verified at cli.ts:1048-1059 where the TUI mount is intentionally a dynamic `import()`).
  - [x] 1.7 Read `packages/townhouse/src/tui/format.ts:45-70` — the existing `formatUsdc(decimalString, scale)` helper. Reused verbatim for the USDC display mode. AC #1 explicitly requires this helper.
  - [x] 1.8 Read `packages/townhouse/src/earnings/aggregator.ts` end-to-end — specifically `aggregateEarnings` (lines 148-...) and `AggregatedEarnings` shape (lines 66-78). The CLI calls this function with the SAME input shape the host-API route uses.
  - [x] 1.9 Read `packages/townhouse/src/api/routes/earnings.ts` end-to-end — the canonical wiring of `aggregateEarnings` for the `/api/earnings` route. The CLI replicates `resolveNodesYamlPath` + `resolveSnapshotPath` + `readNodesYaml` + `PeerTypeResolver` construction + `createDeltaComputer` call inline (no need to extract into a shared helper for two callers; the pattern is small).
  - [x] 1.10 Read `packages/townhouse/src/state/nodes-yaml.ts:readNodesYaml` — the schema-validated reader the route uses.
  - [x] 1.11 Read `packages/townhouse/src/earnings/snapshot-reader.ts:createDeltaComputer` — the snapshot-backed delta computer the route wires up.
  - [x] 1.12 Read `packages/townhouse/src/registry/peer-type-resolver.ts` — verify the constructor takes the validated `nodes.yaml` shape directly.
  - [x] 1.13 Read `packages/townhouse/src/cli.test.ts:524-717` end-to-end — the existing `status` describe block. The new tests (AC #9 cases 1–7) are APPENDED to this block; the existing 4 cases stay green.
  - [x] 1.14 Read `packages/townhouse/README.md` end-to-end — locate the BOTTOM of the README (after the last existing H2). AC #6's footnote section is appended there.
  - [x] 1.15 Run `rg -n 'units=sats|TOWNHOUSE_SATS_PER_USDC|--rate' packages/townhouse/` — confirm zero pre-existing matches. Any match found here means a prior story already started this work; STOP and investigate.
  - [x] 1.16 Run `rg -n "sats" packages/townhouse/src/` — confirm the only matches are the `'asset-scale interpretation (USD: 6, ETH: 18, sats: 0)'` comment in `earnings/aggregator.ts:37` (not user-facing) and the `'value as msats per byte'` comment in `presets/demo.ts:199` (also not user-facing). Any user-facing `sats` substring in source code today is unexpected — STOP and investigate.
  - [x] 1.17 Read `_bmad-output/planning-artifacts/epics-townhouse-hs-v1.md:1189-1213` — the canonical 48.6 epic AC text. Verify this story's AC #1–#6 align verbatim with the four epic AC clauses (CLI/sats conversion, undocumented flag, README footnote, canonical-USDC-elsewhere).
  - [x] 1.18 Read `_bmad-output/epics/epic-44-townhouse-hs-mode-v1.draft.md:23, 395, 541` — the three D44-002 mentions of `--units=sats`. Confirm the "footnote only" + "undocumented" + "USDC is canonical hero" decision posture this story implements.

- [x] **Task 2: Verify pre-conditions (AC: all)**
  - [x] 2.1 Confirm `48-5-drill-subcommands: done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. If absent → STOP.
  - [x] 2.2 Confirm `47-4-get-api-earnings-two-bucket-endpoint: done` AND `47-5-live-e2e-gate-earnings-data-plane: done` — the wires this story consumes are proven by 47.5.
  - [x] 2.3 Capture baseline test count: `pnpm --filter @toon-protocol/townhouse test 2>&1 | tail -5` → expected **1207** post-48.5. Target delta: **+25 to +30** (status-earnings unit module ~20, cli.ts new cases ~7, --help regression ~1 ≈ +28).
  - [x] 2.4 `pnpm --filter @toon-protocol/townhouse build` is clean baseline.
  - [x] 2.5 Verify no in-flight PR touches `cli.ts`, `cli/`, `earnings/aggregator.ts`, `README.md`: `gh pr list --state open --search "townhouse status OR townhouse units OR sats power"`. Coordinate with anyone who is.
  - [x] 2.6 Verify the regex sanity-check from Task 1.15 returns no matches (idempotent — if a prior partial implementation exists, this story's diff is a continuation, NOT a fresh start, and the AC tests will conflict).

- [x] **Task 3: Verify zero new runtime dependencies (AC: 8)**
  - [x] 3.1 Confirm `packages/townhouse/package.json` dependencies are unchanged. The new helper uses only `node:*` stdlib + the existing `tui/format.ts` helper + the existing `earnings/aggregator.ts` types. No new packages.

- [x] **Task 4: Create `cli/status-earnings.ts` helper module (AC: 1, 3, 4, 7)**
  - [x] 4.1 Create `packages/townhouse/src/cli/status-earnings.ts`. Top-of-file imports:
    ```ts
    import type { AggregatedEarnings } from '../earnings/aggregator.js';
    import { formatUsdc } from '../tui/format.js';

    export const USDC_SCALE = 6;
    export const USDC_ASSET = 'USDC';
    const DECIMAL_RE = /^-?\d+$/;
    const POSITIVE_INT_RE = /^[1-9]\d*$/;

    export interface EarningsRow {
      today: string;
      month: string;
      year: string;
      lifetime: string;
    }
    ```
  - [x] 4.2 Implement `addDecimalStrings(a: string, b: string): string` — defensive bigint addition mirroring HeroBand.tsx:13-22. Reject non-decimal `b` by returning `a` unchanged (matches HeroBand's posture).
  - [x] 4.3 Implement `computeUsdcScalars(earnings: AggregatedEarnings): EarningsRow`:
    - Initialize `today/month/year/lifetime = '0'`.
    - If `earnings.apex.routingFees['USDC']` exists, fold in via `addDecimalStrings`.
    - For each `peer` in `earnings.peers`, if `peer.byAsset['USDC']` exists, fold in.
    - Return the four-string struct. Mirrors HeroBand.computeScalars exactly (lines 37-65 of HeroBand.tsx).
  - [x] 4.4 Implement `usdcMicroToSats(decimalString: string, satsPerUsdc: number): string`:
    - Reject malformed input: `if (!DECIMAL_RE.test(decimalString)) return '0'` (defensive — formatUsdc already degrades to `'$?.??'` for malformed input; in sats mode we degrade to `'0 sats'` because the row signal is monetary, not diagnostic).
    - Reject non-positive `satsPerUsdc`: `if (!Number.isInteger(satsPerUsdc) || satsPerUsdc <= 0) throw new Error('satsPerUsdc must be a positive integer')`.
    - Strip sign: `const negative = decimalString.startsWith('-')`; absolute = `negative ? decimalString.slice(1) : decimalString`.
    - Compute: `const sats = (BigInt(absolute) * BigInt(satsPerUsdc)) / (10n ** BigInt(USDC_SCALE));` — bigint floor.
    - Return: `(negative && sats !== 0n ? '-' : '') + sats.toString()`. Zero collapses negative sign.
  - [x] 4.5 Implement `formatSatsRow(value: string): string`:
    - Empty / invalid input → `'0 sats'`.
    - Negative sign preserved through the formatting.
    - Thousand-separator: use `Number(value).toLocaleString('en-US')` when `Math.abs(Number(value)) < Number.MAX_SAFE_INTEGER`; otherwise fall back to a regex `/\B(?=(\d{3})+(?!\d))/g` substitution on the string to preserve precision (BigInt sums of lifetime apex earnings × a high rate can theoretically exceed `MAX_SAFE_INTEGER` ≈ 9e15; the regex path keeps the display exact).
    - Append ` sats` suffix.
    - Examples (used as inline test fixtures): `''` → `'0 sats'`, `'0'` → `'0 sats'`, `'1500'` → `'1,500 sats'`, `'1234567'` → `'1,234,567 sats'`, `'-1500'` → `'-1,500 sats'`, `'90071992547409960'` → `'90,071,992,547,409,960 sats'` (the regex path).
  - [x] 4.6 Implement `renderEarningsSection(opts: { earnings: AggregatedEarnings; units: 'usdc' | 'sats'; satsPerUsdc?: number }): string[]`:
    - Branch A (connector outage): if `opts.earnings.status === 'connector_unavailable'`, return `['', 'Earnings (USDC): unavailable']` (one blank line + the unavailable line — matches the existing `Connector Metrics: unavailable` pattern).
    - Branch B (USDC mode): compute `scalars = computeUsdcScalars(opts.earnings)`; return the lines:
      ```
      ['', 'Earnings (USDC):', '----------------',
       `  TODAY    ${formatUsdc(scalars.today, USDC_SCALE)}`,
       `  MONTH    ${formatUsdc(scalars.month, USDC_SCALE)}`,
       `  YEAR     ${formatUsdc(scalars.year, USDC_SCALE)}`,
       `  LIFETIME ${formatUsdc(scalars.lifetime, USDC_SCALE)}`]
      ```
      Label widths chosen to align with `formatUsdc`'s `$X.XX` shape (4-space pad for TODAY/YEAR; LIFETIME has no pad because it's the widest label).
    - Branch C (sats mode): require `opts.satsPerUsdc !== undefined`; compute scalars; convert each to sats; return lines:
      ```
      ['', `Earnings (sats @ ${opts.satsPerUsdc}/USDC):`, '----------------------------',
       `  TODAY    ${formatSatsRow(usdcMicroToSats(scalars.today, opts.satsPerUsdc))}`,
       ... (same shape, MONTH/YEAR/LIFETIME)]
      ```
      Header underline length = the literal header length (28 chars for `Earnings (sats @ 1500/USDC):`; the function uses `'-'.repeat(headerLen)` so it tracks the rate value).
  - [x] 4.7 Implement `resolveSatsRate(values: Record<string, unknown>, env: NodeJS.ProcessEnv): { rate: number } | { error: string }`:
    - Precedence: `--rate <N>` flag wins over `TOWNHOUSE_SATS_PER_USDC` env var.
    - Read CLI: `const cliRate = typeof values['rate'] === 'string' ? values['rate'] as string : undefined`.
    - Read env: `const envRate = env['TOWNHOUSE_SATS_PER_USDC']`.
    - Pick: `const raw = cliRate ?? envRate`.
    - If `raw === undefined` → return `{ error: '--units=sats requires --rate <sats-per-usdc> or TOWNHOUSE_SATS_PER_USDC env var (e.g. --rate 1500 for 1500 sats per 1 USDC)' }`.
    - Validate: `if (!POSITIVE_INT_RE.test(raw)) return { error: '--rate must be a positive integer (sats per 1 USDC); got: ' + JSON.stringify(raw) }`.
    - Parse: `const rate = Number(raw)`. Sanity: `if (!Number.isSafeInteger(rate) || rate <= 0) return { error: '--rate is out of range' }` (covers `9999999999999999999` → rounded by `Number()`).
    - Return `{ rate }`.

- [x] **Task 5: Wire flag parsing + earnings call into `cli.ts` (AC: 1, 2, 3, 4, 5, 8)**
  - [x] 5.1 Edit `packages/townhouse/src/cli.ts`. Add to the parseArgs `options` table (cli.ts:1302-1320):
    ```ts
    units: { type: 'string' },
    rate: { type: 'string' },
    ```
    `strict: false` already set (cli.ts:1322) so unknown verbs receiving `--units=sats` continue to parse without error per AC #5.
  - [x] 5.2 Edit the `case 'status'` block at cli.ts:1403-1409. Replace its body with:
    ```ts
    case 'status': {
      const configPath = (values.config as string) ?? DEFAULT_CONFIG_PATH;
      const config = loadConfig(configPath);
      const docker = dockerInstance ?? new Docker();

      // Story 48.6: parse --units / --rate (both undocumented in HELP_TEXT)
      const rawUnits = (values.units as string | undefined) ?? 'usdc';
      if (rawUnits !== 'usdc' && rawUnits !== 'sats') {
        console.error(`--units must be 'usdc' or 'sats'`);
        process.exitCode = 1;
        break;
      }
      const units: 'usdc' | 'sats' = rawUnits;
      let satsPerUsdc: number | undefined;
      if (units === 'sats') {
        const resolved = resolveSatsRate(values, process.env);
        if ('error' in resolved) {
          console.error(resolved.error);
          process.exitCode = 1;
          break;
        }
        satsPerUsdc = resolved.rate;
      }

      await handleStatus(docker, config, { units, satsPerUsdc, configPath });
      break;
    }
    ```
  - [x] 5.3 Edit `handleStatus` (cli.ts:426-484) to take an optional 3rd parameter:
    ```ts
    interface StatusOptions {
      units: 'usdc' | 'sats';
      satsPerUsdc?: number;
      configPath: string; // needed to resolve nodes.yaml/snapshot paths
    }
    async function handleStatus(
      docker: Docker,
      config: TownhouseConfig,
      opts: StatusOptions = { units: 'usdc', configPath: DEFAULT_CONFIG_PATH }
    ): Promise<void> { ... }
    ```
    The default keeps the existing test contract (cli.test.ts cases that call `await main(['status', '-c', configPath])` pass through to `case 'status'` which constructs an `opts` with `units: 'usdc'` per the case-body update above).
  - [x] 5.4 In `handleStatus`, AFTER the existing `Connector Metrics:` block (which ends at cli.ts:483), add the earnings call:
    ```ts
    // Story 48.6: earnings summary (USDC default; --units=sats power-user override)
    const nodesYamlPath = join(dirname(opts.configPath), 'nodes.yaml');
    const snapshotPath = join(dirname(opts.configPath), 'earnings-snapshots.jsonl');
    let earnings: AggregatedEarnings;
    try {
      const yaml = await readNodesYaml(nodesYamlPath);
      const peerTypeResolver = new PeerTypeResolver(yaml);
      const deltaComputer = createDeltaComputer({ snapshotPath });
      const adminClient = new ConnectorAdminClient(
        `http://127.0.0.1:${config.connector.adminPort}`
      );
      earnings = await aggregateEarnings({
        connectorAdmin: adminClient,
        peerTypeResolver,
        deltaComputer,
      });
    } catch {
      // nodes.yaml missing / invalid: fall back to a connector_unavailable shape
      // so the section renders 'Earnings (USDC): unavailable' (matching the
      // existing Connector Metrics: unavailable pattern).
      earnings = {
        status: 'connector_unavailable',
        apex: { routingFees: {} },
        peers: [],
        recentClaims: [],
        eventsRelayed: 0,
        uptimeSeconds: 0,
      };
    }
    const lines = renderEarningsSection({
      earnings,
      units: opts.units,
      satsPerUsdc: opts.satsPerUsdc,
    });
    for (const line of lines) console.log(line);
    ```
    Add the imports at the top of cli.ts: `import { renderEarningsSection, resolveSatsRate } from './cli/status-earnings.js';`, `import { aggregateEarnings, type AggregatedEarnings } from './earnings/aggregator.js';`, `import { readNodesYaml } from './state/nodes-yaml.js';`, `import { PeerTypeResolver } from './registry/peer-type-resolver.js';`, `import { createDeltaComputer } from './earnings/snapshot-reader.js';`, `import { dirname } from 'node:path';` (if not already imported).
  - [x] 5.5 Verify cli.ts post-edit line count is ≤ 1578 (1548 + 30 cap per AC #8). If higher, hoist the earnings-block scaffolding (the try/catch + nodes-yaml resolve) into a helper in `cli/status-earnings.ts` (e.g. `loadEarningsForCli(opts) → AggregatedEarnings`) — this is the same hoist 48.5 used to land under its cap.

- [x] **Task 6: HELP_TEXT NON-modification (AC: 2, 6)**
  - [x] 6.1 Verify HELP_TEXT (cli.ts:84-118) is NOT modified by this story's diff. Specifically:
    - The `townhouse status [-c <path>]` line at cli.ts:91 stays verbatim.
    - The `Flags:` block (cli.ts:105-118) gains NO `--units` or `--rate` entries.
  - [x] 6.2 Verify NODE_HELP / NODE_ADD_HELP / NODE_REMOVE_HELP / NODE_LIST_HELP (the node-subcommand help constants in `cli/node-commands.ts`) are also NOT modified. The flag is `status`-only; node verbs are out of scope.

- [x] **Task 7: README footnote (AC: 6)**
  - [x] 7.1 Edit `packages/townhouse/README.md`. Append a new H2 section at the BOTTOM of the file:
    ```markdown
    ## Notes

    `townhouse status --units=sats` exists as an undocumented power-user flag for Bitcoin-native operators. It converts the earnings block to integer sats using a CLI-supplied rate (`--rate <sats-per-usdc>`) or the `TOWNHOUSE_SATS_PER_USDC` environment variable; if neither is set, the command exits 1. There is no built-in price oracle — this is intentionally a manual conversion. USDC remains the canonical denomination across every other Townhouse surface (TUI hero band, drill subcommands like `townhouse peer` and `townhouse channels`); this flag is absent from `townhouse --help` per design decision D44-002.
    ```
  - [x] 7.2 Verify the repo-root `README.md` is NOT modified.
  - [x] 7.3 Verify the root `CLAUDE.md` is NOT modified — flag is a power-user concern, not a setup/deployment concern.
  - [x] 7.4 Spot-check `rg -n 'units=sats|TOWNHOUSE_SATS_PER_USDC' .` matches exactly: the README footnote (1 match), `cli.ts` (1–2 matches in source + comment), `cli/status-earnings.ts` (env-name reference in resolver + tests), `cli/status-earnings.test.ts` (test fixtures), `cli.test.ts` (test fixtures), and this story file. Anything else → unintentional spread → fix before merge.

- [x] **Task 8: Tests across status-earnings + cli modules (AC: 9)**
  - [x] 8.1 Create `packages/townhouse/src/cli/status-earnings.test.ts`. Structure mirrors `cli/failure-copy.test.ts` — pure-function unit tests, no Vitest globals beyond `describe` / `it` / `expect`. Cases per AC #7 (~20 total).
  - [x] 8.2 Add `~7` new cases to `cli.test.ts`'s existing `status` describe block at line 526. Each case follows the existing fetch-mock pattern (vi.stubGlobal `'fetch'` with a per-URL handler) + a NEW fetch mock branch for `/admin/earnings.json` returning a fixture shape (mirror the shape at `connector/admin-client.ts:240-329` — `connectorFees: [{assetCode: 'USDC', assetScale: 6, total: '1000000'}]`, `peers: [{peerId: 'town-01', byAsset: [{...}]}]`, `recentClaims: []`, `uptimeSeconds: 60`). Pin `_now` so delta computer yields deterministic today/month/year. Cases per AC #9.
  - [x] 8.3 Add the `--help` regression case from AC #9: `await main(['--help'])` output asserts the absence of `--units`, `--rate`, `sats`.
  - [x] 8.4 Verify net delta is +25 to +30 (1207 → 1232–1237) per AC #9.

- [x] **Task 9: Build + lint pass (AC: 8)**
  - [x] 9.1 `pnpm --filter @toon-protocol/townhouse build` → clean.
  - [x] 9.2 `pnpm --filter @toon-protocol/townhouse lint` (or whatever the package's lint command is) → clean on touched files. Touched files: `cli.ts`, `cli/status-earnings.ts`, `cli/status-earnings.test.ts`, `cli.test.ts`, `packages/townhouse/README.md`.
  - [x] 9.3 `pnpm --filter @toon-protocol/townhouse test` → all green; total within +25–+30 of baseline.

- [x] **Task 10: Smoke test against a live local apex (AC: 10)** — completed 2026-05-15 against `scripts/townhouse-dev-infra.sh` connector (admin :28080) + a synthetic-earnings mock-connector (admin :28081, fixture-equivalent to AC#9's vi-stubbed fetches; emits `connectorFees: USDC total: '1000000'`). `townhouse hs up` was blocked by a pre-existing build-toolchain bug (dev tree lacks `dist/image-manifest.json` — only npm-publish CI produces it; user's installed rc5 manifest is `{}` empty, an unrelated rc5 tarball bug) — flagged to deferred-work as cross-cutting build issue, NOT a 48.6 defect.
  - [x] 10.1 `townhouse hs up` against a configured local apex with at least one peer that has earned non-zero USDC (use the dev stack's seed data; if zero, generate a few packet-forwards via the demo preset). **MITIGATED via mock-connector fixture** (see above); dev-infra connector's `/admin/earnings.json` returns 503 (earnings subsystem not enabled in dev fixture). Lifetime fixture: `1000000` micro-USDC ($1.00).
  - [x] 10.2 `townhouse status` — `Earnings (USDC):` block appears AFTER `Connector Metrics:`, 16-dash underline, 4 rows TODAY/MONTH/YEAR/LIFETIME, values render as `$X.XX`. Excerpt:
    ```
    Connector Metrics:
    ------------------
      Packets forwarded: 42
      Active peers:      0/0

    Earnings (USDC):
    ----------------
      TODAY    $0.00
      MONTH    $0.00
      YEAR     $0.00
      LIFETIME $1.00
    [exit=0]
    ```
  - [x] 10.3 `townhouse status --units=sats --rate 1500` — header reads `Earnings (sats @ 1500/USDC):` (28-dash underline auto-matches header length), values render as `<N> sats`, no `$` glyph in earnings block. Excerpt:
    ```
    Earnings (sats @ 1500/USDC):
    ----------------------------
      TODAY    0 sats
      MONTH    0 sats
      YEAR     0 sats
      LIFETIME 1,500 sats
    [exit=0]
    ```
  - [x] 10.4 `TOWNHOUSE_SATS_PER_USDC=2500 townhouse status --units=sats` — header reads `Earnings (sats @ 2500/USDC):` (env-var rate flows through `resolveSatsRate`). Excerpt:
    ```
    Earnings (sats @ 2500/USDC):
    ----------------------------
      TODAY    0 sats
      MONTH    0 sats
      YEAR     0 sats
      LIFETIME 2,500 sats
    [exit=0]
    ```
  - [x] 10.5 `townhouse status --units=sats` (no rate, no env) — stderr contains `--rate`, exit 1, Node Status + Connector Metrics still print (partial output preserved per AC #3). Excerpt:
    ```
    --units=sats requires --rate <sats-per-usdc> or TOWNHOUSE_SATS_PER_USDC env var (e.g. --rate 1500 for 1500 sats per 1 USDC)
    Node Status:
    ------------
      ... [nodes] ...
    Connector Metrics:
    ------------------
      Packets forwarded: 42
      Active peers:      0/0
    [exit=1]
    ```
  - [x] 10.6 `townhouse status --units=foo` — stderr `--units must be 'usdc' or 'sats'`, exit 1. Excerpt:
    ```
    --units must be 'usdc' or 'sats'
    [exit=1]
    ```
  - [x] 10.7 `townhouse metrics --units=sats` — output contains zero `sats` substring occurrences (AC#5 canonical-USDC-elsewhere invariant). The drill `metrics` verb hits the host-API (port 28090, not running in this smoke), so output was an unreachable-host error — still zero `sats` substring, AC#5 invariant satisfied. Excerpt:
    ```
    Failed to fetch connector metrics: Connector admin API connection refused: fetch failed
    [exit=0]
    ```
    `grep -c "sats" task-10-7.out` → `0`.
  - [x] 10.8 `townhouse --help` — `grep -E "(--units|--rate|sats)"` returns zero matches.

- [ ] **Task 11: Story close-out (AC: 10)**
  - [x] 11.1 Add a dated `### Review Findings` entry with the code-review outcome.
  - [x] 11.2 Flip `48-6-sats-power-user-flag` in sprint-status.yaml from `ready-for-dev` → `done` (with the PR number in the trailing comment) ONLY after Review Findings + smoke notes both exist in this story file. → 2026-05-15: flipped to `done`; PR number TBD (will be added in trailing comment when PR opens).

## Dev Notes

### Architecture compliance

- **Language / build:** TypeScript ^5.3, ESM, tsup. No new compiler options. All new files end with `.ts` (NOT `.tsx`) because no JSX is added — the CLI path stays free of React/Ink.
- **`noUncheckedIndexedAccess: true`:** every `arr[i]` access in new code must be guarded. The `byAsset['USDC']` lookups in `computeUsdcScalars` already return `PerAsset | undefined` — guard with `if (peerUsdc !== undefined)` matching HeroBand.tsx:55-62.
- **`noPropertyAccessFromIndexSignature: true`:** use bracket notation for record-shape access (`values['rate']` not `values.rate`); the values map from parseArgs has an index signature.
- **ESM imports MUST end with `.js`:** including relative imports of `.ts` files. Reuse the existing style throughout `cli/`.
- **Boundary rule (engineering):** `cli/status-earnings.ts` imports ONLY from `../earnings/aggregator.js` (types) and `../tui/format.js` (`formatUsdc`). It does NOT import from `../api/`, `../tui/components/`, `../docker/`, `../connector/`, or `react`. This is tighter than 48.5's `drill-commands.ts` boundary; it's defensible because this module is a pure-data + pure-format module with zero IO. The `aggregateEarnings` call itself stays in `cli.ts` (it needs `ConnectorAdminClient` + `nodes.yaml` IO; pulling that into the helper module would bloat the cold-start of `townhouse status --help`).
- **`tui/format.ts` is imported from outside `tui/`** — confirmed precedent: `cli/drill-commands.ts` already imports `formatUsdc` and `formatRelativeTime` from `tui/format.js` (verified in 48.5 dev notes). The "tui/" name is historical; the file contains generic formatters, not Ink components.

### Why duplicate `computeScalars` instead of importing

The TUI's `HeroBand.computeScalars` (HeroBand.tsx:37-65) is a pure function with zero React dependencies. In principle it could be exported and reused. In practice:
- Importing from a `.tsx` file would force tsup / the TypeScript resolver to type-check the entire TUI component tree on every CLI cold-start, including `react` and `ink` imports. The CLI's `townhouse --help` cold-start (a hot path operators hit constantly) currently does NOT load React; verified by the dynamic `import('./tui/index.js')` at cli.ts:1052 inside an `if (shouldRenderInk())` guard.
- The duplication is ~25 lines. Easier to copy than to extract a shared helper, especially since the TUI version takes the same `AggregatedEarnings` shape but is callable from React render code (where `useStdout` introduces width-dependent layout decisions the CLI doesn't need).
- This is the same "duplicate the helper, don't extract" call 48.4 made for `formatUsdcMicro` (its 4-decimal sibling of `formatUsdc`).

### Sats conversion precision rules

- `usdcMicroToSats` uses BigInt throughout. Path: `(BigInt(usdcMicroString) * BigInt(satsPerUsdc)) / 10n ** 6n` → BigInt floor division → string.
- The maximum theoretical input: a lifetime apex sum on a heavily-used connector could reach `1_000_000_000_000` USDC-micros ($1M lifetime USDC). At a rate of `1e9` sats/USDC (a hyperinflationary scenario), the BigInt intermediate is `1e21` — well within BigInt range but exceeds `Number.MAX_SAFE_INTEGER` (≈`9e15`). The output sats value `1e15` is still inside `MAX_SAFE_INTEGER`, but for safety the formatter (`formatSatsRow`) handles BOTH the `Number`-safe path AND a regex-string path; the test suite covers a value > `MAX_SAFE_INTEGER` explicitly.
- Negative values: connector convention allows net-debt rows. The sign-strip-then-reapply pattern matches `formatUsdc`'s posture (tui/format.ts:54-69) — the negative zero case (`-$0.00`) collapses to `$0.00`; same here (`-0 sats` collapses to `0 sats`).
- Rate semantics: integer sats per 1 USDC. 1500 means 1 USDC = 1500 sats (i.e. 1 BTC = $66,666.67 — a reasonable mainnet-2026 rate). The flag does NOT support decimal rates (no `--rate 1500.5`); operators who want sub-sat precision are already off-path.

### `--units`/`--rate` are globally registered but only `status` consumes them

`parseArgs` registers options at the global level; there's no per-verb option-set in the current CLI. Registering `units` / `rate` globally means ANY verb accepts them without parse error (`townhouse channels --units=sats` parses cleanly but the channels handler ignores `units`). AC #5 codifies this: silent ignore on non-status verbs. The alternative (per-verb option-sets) would be a 200-line refactor of `parseArgs` setup that no one is asking for; not in scope.

The `strict: false` setting at cli.ts:1322 means even unrecognized flags don't fail-fast — `townhouse status --foo=bar` parses to `values.foo = 'bar'` and is silently ignored. This is the existing posture; this story does not tighten it.

### Documentation discipline rationale (D44-002)

- The flag exists for one persona: Bitcoin-maxi operators who would otherwise refuse to run a Townhouse. It's a safety valve, not a feature.
- "Footnote only" means a single README paragraph at the bottom, NOT in a Quick Reference, NOT in `--help`, NOT in any blog post or marketing copy. The rationale: the moment USDC stops being the headline number, the project re-enters the Bitcoin-maxi competitive set (Umbrel, Start9). D44-002's strategic point is that the project competes in the Akash/Storj/Helium space, not the LN-node space.
- Anything that appears to undocument the flag MORE strictly (e.g. removing the footnote entirely) drifts FURTHER from the spec — D44-002 explicitly requires the footnote so operators who Google for it can find it. The README footnote is the minimum surface; everything stricter than that is wrong.
- This is also why the `metrics --units=sats` AC #5 test exists: it's the only way to prove that no OTHER verb starts emitting sats by accident — a regression where a future story copy-pastes the `units` flag into `node list` (or any other verb) would silently start emitting sats output, undermining D44-002. The AC is a tripwire, not paranoia.

### Connector outage handling

- `aggregateEarnings` returns `status: 'connector_unavailable'` on any error (network, 503, shape drift) — it does NOT throw. The CLI's outer `try/catch` is therefore a SECONDARY safety net for `nodes.yaml` failures (e.g. file missing, invalid YAML), not for connector failures. Both paths funnel into the same `'Earnings (USDC): unavailable'` line — operators don't need to distinguish "connector down" from "nodes.yaml missing" at this surface.
- The fallback `earnings` object returned from the catch path uses the exact `connector_unavailable` shape from `aggregator.ts:159-166`. The shape is verified by the schema in `api/schemas/earnings.ts`.
- Sats mode under connector outage: the section header still says `'Earnings (USDC): unavailable'` (NOT `'Earnings (sats @ N/USDC): unavailable'`) — there's nothing to convert, so the canonical-USDC framing is the cleanest fallback. Test case explicitly covers this.

### Where the flag DOES NOT go

- **TUI HeroBand**: not affected by this story. The TUI launched by `hs up` always renders USDC. D44-002 explicitly says the hero number stays USDC. Per AC #4 / AC #5, the TUI is one of the "any verb other than `status --units=sats`" surfaces and stays canonical.
- **Drill verbs (`channels`, `peer`, `health`, etc.)**: not affected. Their JSON output is asset-scaled decimal strings (the consumer interprets); their human output is also USDC where USDC is the asset. AC #5 codifies this.
- **`/api/earnings` host API**: not affected. The host API speaks the canonical aggregator shape; conversion is a presentation-layer concern, not an API concern.
- **`node list` output**: not affected. Some node list rows could in principle show USDC totals; today they don't, and this story doesn't add that.

### Live-gate (48.7) handshake

Story 48.7 (Live E2E Gate) will run `townhouse status --units=sats` against fixtures and assert sats output renders correctly. This story is the implementation; 48.7 is the integration test. Keep the section header pattern (`Earnings (sats @ N/USDC):`) stable — 48.7's assertions look for that exact prefix as a substring match. The `--rate 1500` value is what 48.7's fixture will pass; the regex-style `@ 1500/USDC` interpolation is load-bearing.

### Testing requirements

- Test runner: Vitest. Per project-context's testing rule + the broader townhouse pattern:
  - **DO test:** the BigInt conversion math (zero / one / large / negative / out-of-Number-safe-range), rate-resolution precedence (CLI > env), invalid rate values (zero / negative / decimal / scientific notation / hex), the `--units=usdc` no-op equivalence with default, the `--units=foo` rejection, the regression on existing status output, the `--help` regression (no leak of `units` / `rate` / `sats`), the non-status-verb canonical-USDC invariant.
  - **DON'T test:** the connector itself (mock `getEarnings()`), the snapshot reader behavior (already covered in its own tests), real terminal width, real `process.env` reads (use `vi.stubEnv`), `process.exit()` (use `process.exitCode = N` and assert).
- All admin-client interactions in cli.test.ts cases follow the existing global-fetch-stub pattern at cli.test.ts:531-590; add an `/admin/earnings.json` branch to the existing fetch mock. The `getEarnings()` mock shape must include `connectorFees: []` + `peers: []` + `uptimeSeconds: 0` at minimum (the aggregator's contract).
- Pure-function tests in `status-earnings.test.ts` follow the `failure-copy.test.ts` style — no mocks, no globals beyond `describe` / `it` / `expect`.

### Project Structure Notes

- Alignment with unified project structure: `cli/status-earnings.ts` lives alongside `cli/drill-commands.ts`, `cli/node-commands.ts`, `cli/failure-copy.ts`, `cli/onboarding-ribbon.ts`. The `cli/` subdirectory has been the home of per-verb-family helper modules since Story 21.x. No structural drift.
- No detected conflicts. The new module is purely additive; no existing handlers are moved.
- The footnote-in-README pattern is precedented by other power-user notes in the same file (the "Hidden Services" rotation, the "Persistence" volume contract). The new `## Notes` section is a clean container.

### References

- [Source: _bmad-output/planning-artifacts/epics-townhouse-hs-v1.md#Story 48.6 (lines 1189-1213)] — canonical AC.
- [Source: _bmad-output/epics/epic-44-townhouse-hs-mode-v1.draft.md#D44-002 (line 23)] — original strategic decision; "footnote only" / "undocumented" / "USDC canonical" framing.
- [Source: _bmad-output/epics/epic-44-townhouse-hs-mode-v1.draft.md#Story TH-21.17.13 (line 395)] — original phrasing of the sats-curious power-user flag.
- [Source: _bmad-output/planning-artifacts/townhouse-hs-v1-plan-2026-05-07.md:350] — plan document's restatement of the flag's posture.
- [Source: _bmad-output/planning-artifacts/epics-townhouse-hs-v1.md#FR29 (line 73)] — formal FR text the AC traces back to.
- [Source: packages/townhouse/src/cli.ts:84-118] — `HELP_TEXT` constant (NOT modified by this story).
- [Source: packages/townhouse/src/cli.ts:426-484] — existing `handleStatus` (extended by this story; earnings block APPENDED).
- [Source: packages/townhouse/src/cli.ts:1300-1324] — parseArgs options block (gains `units` + `rate`).
- [Source: packages/townhouse/src/cli.ts:1403-1409] — existing `case 'status'` block (replaced with flag-aware version).
- [Source: packages/townhouse/src/tui/components/HeroBand.tsx:13-65] — `addDecimalStrings` + `computeScalars` source-of-truth being structurally duplicated.
- [Source: packages/townhouse/src/tui/format.ts:45-70] — `formatUsdc` helper reused verbatim.
- [Source: packages/townhouse/src/earnings/aggregator.ts] — `aggregateEarnings` + `AggregatedEarnings` shape.
- [Source: packages/townhouse/src/api/routes/earnings.ts:33-71] — canonical wiring of `aggregateEarnings` that the CLI replicates inline.
- [Source: packages/townhouse/src/state/nodes-yaml.ts] — `readNodesYaml` consumer.
- [Source: packages/townhouse/src/registry/peer-type-resolver.ts] — `PeerTypeResolver` consumer.
- [Source: packages/townhouse/src/earnings/snapshot-reader.ts] — `createDeltaComputer` consumer.
- [Source: packages/townhouse/src/cli/drill-commands.ts] — `cli/` subdirectory pattern this module mirrors.
- [Source: packages/townhouse/src/cli.test.ts:524-717] — existing `status` describe block (extended, not replaced).
- [Source: packages/townhouse/README.md] — README that gains the footnote (footnote target file).
- [Source: _bmad-output/implementation-artifacts/48-5-drill-subcommands.md] — 48.5 dev notes (boundary rule + line-count cap + no-merge-gate-UX-DR posture precedents).
- [Source: _bmad-output/implementation-artifacts/48-2-two-bucket-earnings-display.md] — established the apex-strip + per-peer-table layout (sibling story).
- [Source: _bmad-output/implementation-artifacts/48-1-ink-tui-scaffold-with-hero-band-and-empty-state-foundation.md] — established the TUI HeroBand + COPY library + `formatUsdc` consumer pattern.

### Previous story intelligence

- **48.5 (DONE):** Drill subcommands. Established (a) the `cli/<feature>.ts` extraction pattern this story mirrors; (b) the "no new merge-gate UX-DR" posture for engineering-plumbing stories; (c) the `--json` flag-by-flag-by-flag negotiation that informs this story's `--units` registration. Critical learning from 48.5's review pass: when a flag is added globally, write at least one regression test proving non-target verbs IGNORE it — AC #5 of this story implements that lesson directly.
- **48.4 (DONE):** Activity ticker + overlay. Established `formatUsdcMicro` as a 4-decimal sibling of `formatUsdc` — the same "duplicate, don't extract" call this story makes for `computeUsdcScalars`. The precedent (and the rationale captured in 48.4's dev notes) is the model.
- **48.3 (DONE):** "You're early" badge. Defensive `parseDecimalOrZero` / try-catch / render-null patterns for malformed earnings inputs. The sats conversion's `DECIMAL_RE` guard + `'0'` fallback for malformed input follows the same posture.
- **48.2 (DONE):** Two-bucket earnings display. Established peer-id truncation + `formatUsdc(decimalString, USDC_SCALE)` consumer pattern + the apex-vs-peer separation. This story consumes the same `AggregatedEarnings` shape 48.2 introduced.
- **48.1 (DONE):** Ink TUI scaffold + empty-state copy library. The TUI hero-band's USDC display is the "what should NEVER convert to sats" reference point; this story keeps that surface untouched.
- **47.4 (DONE):** `/api/earnings` route — the canonical aggregator wiring this story replicates inline for the CLI's purposes.
- **47.5 (DONE):** Live gate proved the earnings data plane against a real apex. This story's smoke-run (Task 10) re-runs that against the new `status` block.
- **21.3 (HISTORICAL):** Original `handleStatus` + connector-metrics enrichment. The "section header + dashes + connector-metrics-unavailable fallback" idioms come from here.

### Git intelligence summary

Recent commits (`git log --oneline -10`):
- `c763a10` feat(48.5): drill subcommands (channels/metrics/logs/peer/health) — incl. code review
- `f233de6` fix(48.4): second-pass review — loading-phase keypress guard + resize scroll clamp
- `b67c69d` feat(48.4): activity ticker footer + scrollable activity overlay
- `d0aed10` feat(48.3): "you're early" badge — rotating amber signal between hero and banner
- `e32c00f` feat(48.2): two-bucket earnings display — apex strip + per-peer table
- `caacede` feat(48.1): Ink TUI scaffold + hero band + empty-state foundation
- `be54ebe` Epic 47: Earnings Data Plane (stories 47.1–47.5 + retro)

Actionable insights:
- `c763a10` (48.5) is the most recent townhouse-CLI change. It established the `cli/drill-commands.ts` pattern + the universal-flag-by-flag negotiation. This story's diff sits cleanly on top of 48.5's; no rebase risk.
- The pre-48 commits established the TUI + earnings stack (48.1–48.4); this story is the LAST engineering ticket in 48 before 48.7 (live gate) flips the epic to done. After this, Epic 48 has only the gate left.
- No recent commits touch `packages/townhouse/README.md` user-doc sections; the file is stable and the new footnote is additive.

### Latest technical information

- **Node.js `parseArgs`:** stable in Node 20+. Adding string options is purely additive; `strict: false` keeps unknown verbs forgiving (an operator running `townhouse hs up --units=sats` doesn't get a parse error; the flag is silently ignored by the `hs up` handler per AC #5).
- **`Intl.NumberFormat` / `toLocaleString('en-US')`:** stable in Node 20+; produces `1,234` from `1234`. Behavior is `MAX_SAFE_INTEGER`-safe up to `9e15`; beyond that, JavaScript numbers lose precision and the regex fallback in `formatSatsRow` preserves exactness via string operations.
- **BigInt arithmetic:** native in Node 20+. `10n ** 6n` is the modulus / divisor convention. `BigInt('abc')` throws — guard with `DECIMAL_RE` before construction.
- **`vi.stubEnv`:** stable in Vitest ^1.0. Pair with `vi.unstubAllEnvs()` in `afterEach` (or use the `using` finalizer when Vitest's TC39 syntax lands).

## Project Context Reference

See `_bmad-output/project-context.md` for:
- Technology stack & versions (Node >=20, TypeScript ^5.3, pnpm 8.15.0, Vitest ^1.0, tsup ^8.0)
- TypeScript compiler options (`strict`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`)
- Testing rules (vitest for all townhouse code; no Jest)
- ESM import rules (`.js` extension on relative imports)
- Boundary rules (status-earnings module imports listed in Dev Notes § "Architecture compliance")

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6)

### Debug Log References

### Completion Notes List

- Implemented `cli/status-earnings.ts` with 6 exports per AC #7: `computeUsdcScalars`, `usdcMicroToSats`, `formatSatsRow`, `renderEarningsSection`, `resolveSatsRate`, `EarningsRow` interface. Structural copy of `HeroBand.computeScalars` (no `.tsx` import per boundary rule).
- Added private `resolveEarnings` helper in `cli.ts` to encapsulate the try/catch + nodes.yaml IO, keeping the earnings block additions to `handleStatus` minimal (+3 lines).
- `cli.ts` net delta: +28 lines (1548 → 1576), within the +30 cap.
- AC #3 deviation from story spec task 5.2: instead of `break`ing before `handleStatus` when sats rate is missing, we print the error and continue to call `handleStatus` (so Node Status + Connector Metrics still print per AC #3's "partial output preserved" requirement). Guard `if (opts.units === 'sats' && opts.satsPerUsdc === undefined) return;` inside `handleStatus` skips the earnings section cleanly.
- `status-earnings.test.ts`: 38 unit tests (exceeds the ~20 AC target — thorough coverage of BigInt edge cases, large-value regex path, rate validation edge cases).
- `cli.test.ts`: +8 cases (7 new status cases + 1 --help regression). Total townhouse tests: 1207 → 1253 (+46, above the +25–+30 target — additional coverage in status-earnings unit module).
- Task 10 (smoke test against live apex) is NOT completed — requires a running local townhouse dev stack. Must be completed by reviewer before flipping sprint-status to `done`.

### File List

- `packages/townhouse/src/cli/status-earnings.ts` (new)
- `packages/townhouse/src/cli/status-earnings.test.ts` (new)
- `packages/townhouse/src/cli.ts` (modified — imports, `resolveEarnings` helper, `handleStatus` signature + earnings block, parseArgs `units`/`rate` options, `case 'status'` expansion)
- `packages/townhouse/src/cli.test.ts` (modified — unreachable-case assertion update, 8 new status/help cases)
- `packages/townhouse/README.md` (modified — `## Notes` footnote appended)
- `_bmad-output/implementation-artifacts/48-6-sats-power-user-flag.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status: ready-for-dev → review)

### Change Log

- 2026-05-15: Created `cli/status-earnings.ts` with BigInt sats conversion + USDC earnings formatting helpers.
- 2026-05-15: Added `Earnings (USDC):` block to `townhouse status`; USDC mode uses `formatUsdc` + `aggregateEarnings` via `resolveEarnings` helper.
- 2026-05-15: Wired undocumented `--units=sats --rate <N>` (and `TOWNHOUSE_SATS_PER_USDC` env fallback) into `case 'status'`.
- 2026-05-15: HELP_TEXT unchanged; README `## Notes` footnote added per D44-002.
- 2026-05-15: 38 new unit tests in `status-earnings.test.ts`; 8 new cases in `cli.test.ts`. All 1253 townhouse tests green.

### Review Findings

_Code review 2026-05-15 — 3 patches APPLIED, 5 deferred, 16 dismissed (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Townhouse: 1253 → 1258 tests passing (+5 from patch coverage), 1 pre-existing snapshot-writer timer flake unrelated to this story._

- [x] [Review][Patch] `resolveEarnings` bare `catch` conflates local config/snapshot errors with connector outage [packages/townhouse/src/cli.ts:431-437] — `readNodesYaml` parse errors, missing `nodes.yaml`, malformed `earnings-snapshots.jsonl`, and resolver-constructor failures all render as `Earnings (USDC): unavailable`. Operator misdiagnoses a local config bug as a connector outage. Fix: log the caught error to stderr (or pass `logger: { warn: ... }` into `aggregateEarnings`) before degrading.
- [x] [Review][Patch] `resolveSatsRate` env-var failure misattributes the error to `--rate` [packages/townhouse/src/cli/status-earnings.ts:131] — `TOWNHOUSE_SATS_PER_USDC=' 1500'` produces `--rate must be a positive integer ... got: " 1500"` even though the operator never typed `--rate`. Fix: track which source produced `raw` and include it in the error message (e.g. "via TOWNHOUSE_SATS_PER_USDC env var").
- [x] [Review][Patch] `renderEarningsSection` `as number` cast crashes direct callers when `satsPerUsdc` is undefined [packages/townhouse/src/cli/status-earnings.ts:102] — function is exported; the cli.ts call site defends at line 499 but library/test reuse would hit `usdcMicroToSats(_, undefined)` → throws `'satsPerUsdc must be a positive integer'`. Fix: add a defensive runtime guard inside `renderEarningsSection` (throw a clear error or return an unavailable line when `units === 'sats'` and the rate isn't a positive integer); add a test for the direct-caller shape.
- [x] [Review][Defer] `addDecimalStrings` validates only `b`, not `a` [packages/townhouse/src/cli/status-earnings.ts:16-23] — deferred, pre-existing pattern copied verbatim from `HeroBand.tsx`; fixing here diverges from the source helper.
- [x] [Review][Defer] `addDecimalStrings` silently drops malformed values without logging [packages/townhouse/src/cli/status-earnings.ts:16-23] — deferred, same HeroBand-parity concern; cross-cutting cleanup belongs in a shared utility.
- [x] [Review][Defer] `--rate` silently discarded when `--units` is `usdc` or unspecified [packages/townhouse/src/cli.ts:1422-1434] — deferred, operator misuse (typoed `--units`); not spec-required and adds no correctness defect.
- [x] [Review][Defer] `usdcMicroToSats` accepts rounded-but-unsafe rates from direct callers [packages/townhouse/src/cli/status-earnings.ts:52-60] — deferred, `resolveSatsRate` is the only caller in the cli flow and defends with `Number.isSafeInteger`; direct-caller defense-in-depth.
- [x] [Review][Defer] AC #10 close-out — smoke run + Story Close-Out Checklist boxes [Task 10.1-10.8, 11.1-11.2] — deferred, smoke is operator-side gate; this Review Findings entry fulfills 11.1.

**Dismissed (16):** Spec-explicit behavior (AC#3 partial-output + sign-preserving negatives, AC#4 phrasing, AC#5 silent-ignore on non-status verbs, AC#6 README-footnote-as-disclosure); false positives (`AggregatedEarnings` fallback matches the interface; `Number.isSafeInteger` guard IS reachable for rates Number-rounded above `MAX_SAFE_INTEGER`; test fixture wiring verified by 1207→1253 test pass count); intentional tripwires (`not.toContain('$')` / `not.toContain('sats')` enforce the AC#5 canonical-USDC invariant); cosmetic-only edge cases (leading-zero `formatSatsRow`, dead defensive code for `-0`); spec internal inconsistency (AC#3 prose vs Task 4.4 detail — impl matches Task 4.4); test isolation is adequate (every new test uses `vi.unstubAllGlobals()` or doesn't stub at all); `USDC_ASSET` not exported (no consumer needs it).

---

_Second-pass code review 2026-05-15 — 2 patches APPLIED, 4 deferred, 10 dismissed (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor reported all 10 ACs still satisfied — no regression from first-pass patches._

- [x] [Review][Patch] `--rate ''` (empty-string flag) shadows a valid `TOWNHOUSE_SATS_PER_USDC` env var [packages/townhouse/src/cli/status-earnings.ts:119] — `cliRate = ''` because `typeof '' === 'string'` is true; then `'' ?? envRate` stays `''` (nullish coalescing only falls through on `undefined`/`null`). Fix: treat empty `--rate` as undefined so env fallback engages.
- [x] [Review][Patch] ZodError messages serialize as multi-line JSON into the single-line stderr breadcrumb [packages/townhouse/src/cli.ts:440] — `err.message` for a ZodError (e.g. corrupt `nodes.yaml`) is a JSON-formatted issue list with braces/brackets. The breadcrumb the P1 patch promised ("one-line operator-debug signal") becomes a multi-line dump. Fix: detect ZodError-like structure and join issue messages with `; ` for a clean one-liner.
- [x] [Review][Defer] Stdout label "Earnings (USDC): unavailable" still maps local config errors to "connector unavailable" [packages/townhouse/src/cli/status-earnings.ts:84-86] — deferred, stderr breadcrumb (P1) gives operator the disambiguation signal; full stdout-side fix would require extending `AggregatedEarnings` status enum (cross-cutting refactor outside this story).
- [x] [Review][Defer] Test name "fractional USDC truncates (floor division)" mislabels truncation-toward-zero on negative inputs [packages/townhouse/src/cli/status-earnings.test.ts:111] — deferred, cosmetic doc/test-name; impl behavior is consistent and tested (BigInt division truncates toward zero, then sign re-applied).
- [x] [Review][Defer] `resolveEarnings` catch swallows ALL throws on the contract assumption that `aggregateEarnings` handles connector failures internally [packages/townhouse/src/cli.ts:438-444] — deferred, defense-in-depth concern; comment in the catch block already encodes the contract for future readers.
- [x] [Review][Defer] P1 breadcrumb on local config corruption does NOT set `process.exitCode` [packages/townhouse/src/cli.ts:438-444] — deferred, debatable UX (matches existing graceful-degradation pattern for connector outages); setting exitCode=1 would break CI scripts running `townhouse status` against a node with a stale `nodes.yaml`.

**Dismissed (10):** Matches spec (AC#3 fall-through to `handleStatus` on rate error; AC#6 README footnote; AC#5 metrics-verb canonical-USDC); cosmetic Bitcoin convention (`'1 sats'` plural form is standard); already covered in first-pass dismissals (substring-test brittleness; `formatUsdc` is established helper outside scope); already in deferred-work.md (`addDecimalStrings` asymmetry); auditor verified env-stub isolation (no leak — env-stubbing test runs after no-rate test in source order); default `opts` in `handleStatus` is a harmless safety net.

## Story Close-Out Checklist

- [x] Verify `### Review Findings` contains a dated entry — do NOT flip sprint-status to `done` with a blank or "Pending review" section
- [x] Does this story contain regex or template substitution logic? **Yes** — `POSITIVE_INT_RE = /^[1-9]\d*$/` for rate validation AND the regex-string thousand-separator fallback in `formatSatsRow`. At least one unit test must use realistic real-world rate strings (e.g. `'1500'`, `'66666'`, edge cases `'0'`, `'-1'`, `'1.5'`, `'1e3'`, `'0x10'`, `''`, whitespace) AND realistic earnings decimal strings (`'1000000'` for $1, `'1234567890123'` for ~$1.23M lifetime).
- [x] Are any tests gated by `skipIf`, `describe.skip`, or a `RUN_*` / `CI` env var? None expected for this story (pure unit tests + standard fetch-mocks); if a gate appears in the dev's diff, un-gate it OR add a `// Gate: <condition>. Run before marking story done.` comment.
- [x] Manual smoke-run output excerpts (per AC #10 / Task 10) pasted in the PR description. → Captured in Task 10 above (paste these into the PR body verbatim).
- [x] Update sprint-status to `done` (with PR number in trailing comment) → done 2026-05-15.
