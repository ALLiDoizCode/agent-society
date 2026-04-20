# @toon-protocol/pet-circuit

PetLifecycle ZkProgram -- ZK-proven pet game rules as o1js circuit constraints.

## Test Runner: Jest (not vitest)

This package uses **Jest** (`^29.7.0` + `ts-jest`) as its test runner, NOT vitest.

**Why:** o1js relies on WASM internals that are incompatible with vitest's module
loading. Running pet-circuit tests under vitest will fail with WASM errors. The
root `vitest.config.ts` explicitly excludes `packages/pet-circuit/**` for this
reason.

All other packages in the monorepo use vitest. Only `pet-circuit` (and
`mina-zkapp`) use Jest.

### Running tests

```bash
# Unit tests (excludes recursive and integration)
pnpm --filter @toon-protocol/pet-circuit test

# Integration tests (requires Mina local blockchain)
pnpm --filter @toon-protocol/pet-circuit test:integration

# Recursive proof tests (slow, 2-5 min per proof)
pnpm --filter @toon-protocol/pet-circuit test:recursive
```

### Jest configuration

See `jest.config.js` in this directory. Key settings:

- `testTimeout: 360000` -- o1js operations are slow even with `proofsEnabled: false`
- `transformIgnorePatterns: ['node_modules/(?!o1js/)']` -- o1js is ESM-native and must be transformed
- `preset: 'ts-jest'` with the local `tsconfig.json`

### Memory requirements

o1js circuit compilation and proving require 2-4 GB of RAM. Do NOT run
pet-circuit tests from CI sub-agents or in memory-constrained environments.
Run locally with explicit user approval only.

## Package structure

| File | Purpose |
|------|---------|
| `PetLifecycle.ts` | ZkProgram for pet state transitions |
| `PetBreeding.ts` | ZkProgram for pet breeding proofs |
| `PetToken.ts` | PET token circuit logic |
| `PetZkApp.ts` | SmartContract wrapping the ZkPrograms |
| `structs.ts` | Shared o1js Struct definitions |
| `constants.ts` | Circuit constants |
| `utils.ts` | Helper functions |
