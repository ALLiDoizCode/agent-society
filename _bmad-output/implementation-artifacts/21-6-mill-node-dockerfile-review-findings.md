# Review Findings — Story 21-6-mill-node-dockerfile

## Findings (Code Review, 2026-04-21)

### PATCH Findings (18) — Requires Fix

- [x] [Review][Patch] inventory null/undefined crash [entrypoint-mill.ts:75] — fixed at `entrypoint-mill.ts:111` (`if (amt === null || amt === undefined) continue`)
- [x] [Review][Patch] JSON parse null handling [entrypoint-mill.ts:130] — fixed at `entrypoint-mill.ts:154-156` (`!rawConfig` throws)
- [x] [Review][Patch] FEE_BASIS_POINTS bounds validation [entrypoint-mill.ts:153] — fixed at `entrypoint-mill.ts:220-223` (0-10000 range check)
- [x] [Review][Patch] Empty MILL_RELAYS overwrites config [entrypoint-mill.ts:162] — fixed at `entrypoint-mill.ts:212` (guards `&& env['MILL_RELAYS'].trim()`)
- [x] [Review][Patch] Channel array validation [entrypoint-mill.ts:66-71] — fixed at `entrypoint-mill.ts:94-103` (`Array.isArray` + entry-shape filter)
- [x] [Review][Patch] Instance identity null checks [entrypoint-mill.ts:199] — fixed at `entrypoint-mill.ts:268-271` (`safePubkey`/`safeEvm`/`safeBlsPort`)
- [x] [Review][Patch] Shutdown handler error [entrypoint-mill.ts:213] — fixed at `entrypoint-mill.ts:287-300` (try/catch + idempotent `shuttingDown`)
- [x] [Review][Patch] better-sqlite3 not found [Dockerfile.mill:79] — fixed at `Dockerfile.mill:89-98` (build fails loudly via `|| { echo "ERROR..."; exit 1; }`)
- [x] [Review][Patch] Empty config file [entrypoint-mill.ts:139] — fixed at `entrypoint-mill.ts:166-168` (`!content.trim()` throws)
- [x] [Review][Patch] Sensitive env cleanup [entrypoint-mill.ts] — closed by Story 21.6.1 (commit `0912c88`); `delete process.env['MILL_CONFIG_JSON']` at `entrypoint-mill.ts:188-189`, fail-closed before `parseRawConfig` runs
- [x] [Review][Patch] Missing Dockerfile LABEL [Dockerfile.mill] — closed by Story 21.6.1 (commit `0912c88`); LABELs moved from pre-builder to runtime stage at `Dockerfile.mill:104-106` (after `FROM node:20-alpine` at `:100`)
- [x] [Review][Patch] Structured logging [entrypoint-mill.ts] — closed by Story 21.6.1 (commit `0912c88`); `logJson` helper at `entrypoint-mill.ts:32-50`; all entrypoint logs migrated to JSON-per-line (`starting`, `mill_ready`, `shutdown_received`, `shutdown_complete`, `shutdown_error`, `fatal`)
- [x] [Review][Patch] SIGQUIT handling [entrypoint-mill.ts] — closed by Story 21.6.1 (commit `0912c88`); `process.on('SIGQUIT', ...)` at `entrypoint-mill.ts:335`, alongside SIGTERM (`:331`) and SIGINT (`:332`)
- [x] [Review][Patch] Runtime /data ownership [Dockerfile.mill:92] — fixed at `Dockerfile.mill:109-112` (`chown toon:toon /data`)
- [x] [Review][Patch] Scientific notation in BigInt [entrypoint-mill.ts:50] — fixed at `entrypoint-mill.ts:33-39` (`toBigInt` parses `1e6` strings via `parseFloat`)
- [x] [Review][Patch] swapPairs null safety [entrypoint-mill.ts:181-185] — fixed at `entrypoint-mill.ts:257-259` (`Array.isArray` + non-empty length check)
- [x] [Review][Patch] Channel entry validation [entrypoint-mill.ts] — fixed at `entrypoint-mill.ts:94-103` (covered by #5; entry-shape filter)
- [x] [Review][Patch] Volume permissions [Dockerfile.mill] — fixed at `Dockerfile.mill:109-112` (chown precedes `VOLUME /data` at `:127`)

### DEFER Findings (3) — Deferred, Pre-existing

- [x] [Review][Defer] Entry point import failure — deferred, esbuild build issue
- [x] [Review][Defer] pnpm integrity check — deferred, build-time concern
- [x] [Review][Defer] Build includes test files — deferred, .dockerignore enhancement

---

## Summary

- **18 patch** findings require fixes
- **3 defer** findings noted (pre-existing)
- **2 dismissed** (false positives self-corrected)

---

## Resolution (Story 21.6.1, 2026-04-29)

Cross-checked all 18 PATCH findings against the `epic-21` tip on 2026-04-29.
Outcome:

- **13 fixed-on-merge** — addressed during the original 21.6 development pass
  but the tracking doc was never reconciled. Audit commit `ae5cfb2` flipped
  these `[ ]` → `[x]` with line-range annotations citing the resolving code.
  No code changes were made for these in 21.6.1.

- **4 closed-here** — genuine outstanding work. All four landed in commit
  `0912c88` (`fix(21.6.1): close 4 open Mill review findings`):
  - `#10` MILL_CONFIG_JSON cleanup — `entrypoint-mill.ts` `loadMillConfig`
    deletes the env var immediately after `JSON.parse` succeeds (fail-closed
    before any later throw can leak secret material). MILL_CONFIG_PATH is
    intentionally not cleaned (path ≠ secret).
  - `#11` Dockerfile LABEL placement — `Dockerfile.mill` LABELs moved from
    before the builder FROM (where Docker silently drops them) into the
    runtime stage. Static-analysis test asserts the placement.
  - `#12` Structured logging — added `logJson(level, msg, fields?)` helper
    writing one JSON object per line (info → stdout, error → stderr).
    Migrated every `console.log`/`console.error` and replaced the ASCII
    "Mill Ready" banner with a structured `mill_ready` event carrying
    `pubkey`, `evmAddress`, `blsPort`, `swapPairCount` fields. Rejected
    Pino on bundle-size grounds (see story Dev Notes § "JSON-per-line, not
    pino").
  - `#13` SIGQUIT handling — `process.on('SIGQUIT', ...)` registered
    alongside SIGTERM/SIGINT, all calling the same idempotent `shutdown()`.

- **0 dismissed-as-stale** — no findings turned out to be false positives or
  obsolete during the audit.

Tests: 422 passing in `@toon-protocol/townhouse` (up from 414); 24 passing in
`@toon-protocol/docker` including 12 new cases in `docker/src/entrypoint-mill.test.ts`
covering AC-1, AC-3, AC-4. The IIFE at the bottom of `entrypoint-mill.ts` is
gated on `!process.env.VITEST` so tests can import the exported helpers
without triggering `main()`.

*Written by Story 21.6.1 (Mill Review Findings Remediation) — closes the
review-debt audit trail for Story 21.6.*

---

*Written by code review workflow — Story 21-6-mill-node-dockerfile*
