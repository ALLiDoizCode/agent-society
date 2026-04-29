# Review Findings — Story 21-6-mill-node-dockerfile

## Findings (Code Review, 2026-04-21)

### PATCH Findings (18) — Requires Fix

- [ ] [Review][Patch] inventory null/undefined crash [entrypoint-mill.ts:75]
- [ ] [Review][Patch] JSON parse null handling [entrypoint-mill.ts:130]
- [ ] [Review][Patch] FEE_BASIS_POINTS bounds validation [entrypoint-mill.ts:153]
- [ ] [Review][Patch] Empty MILL_RELAYS overwrites config [entrypoint-mill.ts:162]
- [ ] [Review][Patch] Channel array validation [entrypoint-mill.ts:66-71]
- [ ] [Review][Patch] Instance identity null checks [entrypoint-mill.ts:199]
- [ ] [Review][Patch] Shutdown handler error [entrypoint-mill.ts:213]
- [ ] [Review][Patch] better-sqlite3 not found [Dockerfile.mill:79]
- [ ] [Review][Patch] Empty config file [entrypoint-mill.ts:139]
- [ ] [Review][Patch] Sensitive env cleanup [entrypoint-mill.ts]
- [ ] [Review][Patch] Missing Dockerfile LABEL [Dockerfile.mill]
- [ ] [Review][Patch] Structured logging [entrypoint-mill.ts]
- [ ] [Review][Patch] SIGQUIT handling [entrypoint-mill.ts]
- [ ] [Review][Patch] Runtime /data ownership [Dockerfile.mill:92]
- [ ] [Review][Patch] Scientific notation in BigInt [entrypoint-mill.ts:50]
- [ ] [Review][Patch] swapPairs null safety [entrypoint-mill.ts:181-185]
- [ ] [Review][Patch] Channel entry validation [entrypoint-mill.ts]
- [ ] [Review][Patch] Volume permissions [Dockerfile.mill]

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