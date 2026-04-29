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
- [ ] [Review][Patch] Sensitive env cleanup [entrypoint-mill.ts]
- [ ] [Review][Patch] Missing Dockerfile LABEL [Dockerfile.mill]
- [ ] [Review][Patch] Structured logging [entrypoint-mill.ts]
- [ ] [Review][Patch] SIGQUIT handling [entrypoint-mill.ts]
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

*Written by code review workflow — Story 21-6-mill-node-dockerfile*
