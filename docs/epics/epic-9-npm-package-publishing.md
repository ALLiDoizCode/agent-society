# Epic 9: npm Package Publishing

**Phase:** Infrastructure
**Estimated Stories:** 6
**Dependencies:** Epics 1–8 (all core library, SPSP, trust, relay, BLS, bootstrap complete)
**Blocks:** Epic 10 (connector library refactoring), Epic 11 (ElizaOS plugin)

---

## Epic Goal

Publish `@agent-society/core`, `@agent-society/bls`, and `@agent-society/relay` as public npm packages so they can be consumed as dependencies by downstream projects — specifically the ElizaOS plugin and any other agent framework integration.

## Epic Description

### Existing System Context

- **Current functionality:** Three packages (`core`, `bls`, `relay`) build successfully with clean public APIs, TypeScript declaration files, and proper `files: ["dist"]` configuration. They are functional as workspace packages within the monorepo but cannot be consumed externally.
- **Technology stack:** TypeScript, tsup (bundler), pnpm workspaces, ESM
- **Integration points:** `relay` depends on `core` and `bls` via `workspace:*` references. `core` has a dev dependency on `relay` for test utilities only.

### What's Being Done

1. **Package metadata:** Add `repository`, `author`, `publishConfig` fields to all three package.json files
2. **Version bump:** Move from `0.1.0` to `1.0.0` for first public release
3. **Dependency resolution:** Replace `workspace:*` references in `relay` and `core` with published version ranges (`^1.0.0`)
4. **Documentation:** Add README.md to `core` and `relay` packages (bls already has one)
5. **Validation:** `npm pack` each package, verify contents exclude source/test files
6. **Publish:** Publish in dependency order: bls → core → relay

### What's NOT Changing

- Package names (`@agent-society/core`, `@agent-society/bls`, `@agent-society/relay`)
- Public API surface — no exports added or removed
- Build system (tsup)
- Test suites
- `@agent-society/examples` stays private

## Acceptance Criteria

- [ ] All three packages published to npm registry with `access: public`
- [ ] `npm install @agent-society/core` works in a fresh project
- [ ] `npm install @agent-society/relay` pulls in core and bls as transitive dependencies
- [ ] TypeScript types resolve correctly when imported (`import { BootstrapService } from '@agent-society/core'`)
- [ ] Package contents contain only `dist/`, `README.md`, `LICENSE` (no source, no tests)
- [ ] Packages are at version `1.0.0`

## Stories

| # | Story | Description | Size |
|---|-------|-------------|------|
| 9.1 | Add publish metadata to all packages | Add repository, author, publishConfig, license fields to core, bls, relay package.json files | S |
| 9.2 | Add README.md to core and relay | Minimal README with package description, install, basic usage example | S |
| 9.3 | Version bump to 1.0.0 | Bump all three packages from 0.1.0 to 1.0.0 | S |
| 9.4 | Resolve workspace references | Replace `workspace:*` in relay's dependencies and core's devDependencies with `^1.0.0` version ranges | S |
| 9.5 | Validate package contents | Run `npm pack` for each package, verify tarball contents, test install in fresh project | M |
| 9.6 | Publish to npm | Publish in order: bls → core → relay. Verify installs and imports work post-publish | M |

---
