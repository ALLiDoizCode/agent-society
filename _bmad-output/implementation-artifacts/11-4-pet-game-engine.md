# Story 11.4: Pet Game Engine

Status: done

## Story

As a TOON Protocol developer,
I want a TypeScript Pet Game Engine (`@toon-protocol/pet-dvm` package) that replicates the exact same game rules as the PetLifecycle ZkProgram -- applying decay, action effects, cooldown enforcement, evolution checks, and stat clamping using plain TypeScript arithmetic,
so that the Pet DVM can process interactions instantly (without ZK proof generation) and produce state that is guaranteed to match what the circuit will later prove.

## Dependencies

- **Upstream:** Story 11-2 (PetLifecycle ZkProgram) -- provides the canonical circuit implementation and golden test vectors. Story 11-2 is DONE.
- **Upstream:** Story 11-1 (napi-rs Memvid Binding) -- provides `PetBrain` for brain hash computation. Story 11-1 is DONE.
- **Upstream:** Story 11-3 (PetZkApp SmartContract) -- provides on-chain settlement patterns. Story 11-3 is DONE.
- **Shared:** `packages/pet-circuit/src/constants.ts` -- all game constants (decay rates, cooldowns, action effects, shop items, evolution thresholds). The game engine MUST import and use these constants, never duplicate them.
- **Shared:** `packages/pet-circuit/src/utils.ts` -- reference implementations of `computeDecay`, `applyAction`, `checkCooldown`, `isActionAllowed`, `blake3ToField`. The game engine wraps these utilities into a stateful engine class. Note: do NOT import `clampStat` (o1js UInt32 type) -- use inline `Math.max(1, Math.min(100, v))` for plain-number clamping.
- **Shared:** `packages/pet-circuit/test-vectors/golden-vectors.json` -- 26 golden test vectors. The game engine MUST produce identical output to the circuit for every vector. This is a P0 blocker.
- **Downstream:** Story 11-5 (Pet DVM Handler) -- imports `PetGameEngine` to process interactions within the DVM handler.
- **External:** No new external dependencies required. The game engine is pure TypeScript using only the existing `@toon-protocol/pet-circuit` constants and utils.

## Acceptance Criteria

1. **AC-1 -- PetGameEngine class:** A `PetGameEngine` class in `packages/pet-dvm/src/engine/PetGameEngine.ts` that encapsulates all game rule logic:
   - Constructor accepts initial `PetEngineState` (stats, stage, cycle, lastInteraction timestamp, cooldown timestamps array, brainHash)
   - Exposes `processInteraction(action: GameAction): InteractionResult` method
   - Exposes `checkEvolution(): EvolutionResult | null` method
   - Exposes `getState(): PetEngineState` readonly accessor
   - Exposes `applyDecayOnly(currentTimestamp: number): DecayResult` method for preview/read-only decay computation
   - Internal state is mutable but only modified through public methods

2. **AC-2 -- processInteraction method:** `processInteraction(action: GameAction)` that:
   - Validates action is allowed for current stage (via `isActionAllowed` from pet-circuit)
   - Validates cooldown has elapsed for this action type (via `checkCooldown` from pet-circuit)
   - Computes elapsed time since `lastInteraction`
   - Applies decay to all stats using `computeDecay` from pet-circuit
   - Applies action effects using `applyAction` from pet-circuit
   - Increments cycle by 1
   - Updates `lastInteraction` to action timestamp
   - Updates cooldown timestamp for the action type
   - Validates token cost via `getRequiredTokenCost(action.actionType, action.itemId)` from pet-circuit -- asserts `action.tokenCost` matches the expected cost
   - Returns `InteractionResult` containing: pre-decay stats, post-decay stats, post-action stats, cycle, stage, tokenCost
   - Throws `GameEngineError` with code `TIMESTAMP_REGRESSION` if `action.timestamp <= lastInteraction` (strict: must be strictly greater)
   - Throws `GameEngineError` with code `INVALID_ACTION` if action not allowed for current stage
   - Throws `GameEngineError` with code `COOLDOWN_ACTIVE` if cooldown not elapsed

3. **AC-3 -- checkEvolution method:** `checkEvolution()` that:
   - Checks current stats and cycle against evolution thresholds from `EVOLUTION_THRESHOLDS` in pet-circuit constants
   - For egg->baby: `cycle >= 7 AND health >= 70 AND hygiene >= 70 AND happiness >= 70`
   - For baby->adult: `cycle >= 21 AND all stats >= 80`
   - Returns `EvolutionResult` with `{ canEvolve: true, fromStage, toStage, resetStats }` if eligible
   - Returns `null` if not eligible
   - Does NOT automatically evolve -- the caller invokes `evolve()` separately
   - Note: Social task attestation is NOT checked by the game engine (DVM-attested, see D4 in game rules canonical doc)

4. **AC-4 -- evolve method:** `evolve()` that:
   - Asserts evolution is possible (calls `checkEvolution()`); throws `GameEngineError` with code `EVOLUTION_NOT_READY` if `checkEvolution()` returns null
   - Applies stage transition effects per Section 5.3 of game rules:
     - Egg->baby: hunger=100, happiness=100, hygiene=100, energy=100, health=inherited, stage=1
     - Baby->adult: all stats inherited, stage=2
   - Does NOT increment cycle (evolution is a separate step from interaction, per Story 11-3 learnings)
   - Returns the new `PetEngineState`

5. **AC-5 -- Type definitions:** `packages/pet-dvm/src/engine/types.ts` with:
   - `PetEngineState`: { stats: StatValues, stage: number, cycle: number, lastInteraction: number, cooldownTimestamps: number[], brainHash: string }
   - `StatValues`: { hunger: number, happiness: number, health: number, hygiene: number, energy: number }
   - `GameAction`: { actionType: number, itemId: number, timestamp: number, tokenCost: number, isSleeping?: boolean }
   - `InteractionResult`: { priorStats: StatValues, decayedStats: StatValues, finalStats: StatValues, cycle: number, stage: number, tokenCost: number }
   - `EvolutionResult`: { canEvolve: boolean, fromStage: number, toStage: number, resetStats: StatValues }
   - `DecayResult`: { decayedStats: StatValues, elapsedSeconds: number }
   - `GameEngineError`: extends Error with `code` field: `'INVALID_ACTION' | 'COOLDOWN_ACTIVE' | 'TIMESTAMP_REGRESSION' | 'EVOLUTION_NOT_READY' | 'INVALID_STAGE' | 'TOKEN_COST_MISMATCH'`

6. **AC-6 -- Golden vector cross-verification:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts` must:
   - Load ALL 26 golden vectors from `packages/pet-circuit/test-vectors/golden-vectors.json`
   - For each vector: create a PetGameEngine with input stats at the vector's stage, process the action, and assert:
     - Post-decay stats match `expectedDecayedStats` exactly
     - Post-action stats match `expectedFinalStats` exactly
   - This is the critical consistency gate -- if any vector diverges, the story FAILS

7. **AC-7 -- Unit tests:** `packages/pet-dvm/src/engine/PetGameEngine.test.ts` with:
   - Test: All 11 cooldown checks per stage (3 stages x 11 actions = 33 combinations; verify allowed/blocked)
   - Test: Evolution check for egg->baby (meets/doesn't meet thresholds)
   - Test: Evolution check for baby->adult (meets/doesn't meet thresholds)
   - Test: evolve() applies correct stat resets for egg->baby
   - Test: evolve() preserves stats for baby->adult
   - Test: Timestamp regression rejected (`GameEngineError` with code `TIMESTAMP_REGRESSION`)
   - Test: Invalid action for stage rejected (`GameEngineError` with code `INVALID_ACTION`)
   - Test: Cooldown not elapsed rejected (`GameEngineError` with code `COOLDOWN_ACTIVE`)
   - Test: Multiple sequential interactions update state correctly (5 interactions in sequence)
   - Test: Stat clamping at boundaries (stat at 1 with negative effect stays at 1, stat at 100 with positive effect stays at 100)
   - Test: Shop item effects applied correctly (at least 2 shop items tested)
   - Test: Sleeping energy recovery (isSleeping=true uses sleep rate)
   - Test: Token cost mismatch rejected (action.tokenCost != getRequiredTokenCost result)
   - Test: Factory function rejects invalid initial state (stage > 2 throws `INVALID_STAGE`, stats out of [1,100] range)

8. **AC-8 -- Package setup:** Create `packages/pet-dvm/` package:
   - `package.json` with name `@toon-protocol/pet-dvm`, version `0.1.0`, private: true
   - Dependency on `@toon-protocol/pet-circuit` (workspace reference)
   - Standalone TypeScript config matching pet-circuit pattern (do NOT extend root tsconfig -- see Dev Notes)
   - Jest config following same pattern as pet-circuit (`.js` file, `module.exports`, `transformIgnorePatterns` for o1js)
   - `src/engine/` directory for game engine code
   - `src/index.ts` exporting PetGameEngine and all types
   - Build script: `tsc`

9. **AC-9 -- Factory function:** `createPetGameEngine(initialState: PetEngineState): PetGameEngine` factory function exported from `packages/pet-dvm/src/engine/PetGameEngine.ts`:
   - Validates initial state (stats in range, stage valid, cycle >= 0)
   - Returns configured PetGameEngine instance
   - Also provide `createGenesisState(): PetEngineState` that returns the default genesis state (all stats 100, stage=0, cycle=0, all cooldowns=0, brainHash='0'.repeat(64))

## Tasks / Subtasks

- [x] Task 1: Package setup (AC: 8)
  - [x] 1.1 Create `packages/pet-dvm/` directory
  - [x] 1.2 Create `package.json` with workspace dependency on `@toon-protocol/pet-circuit`
  - [x] 1.3 Create standalone `tsconfig.json` matching pet-circuit pattern (do NOT extend root)
  - [x] 1.4 Create `jest.config.js` following pet-circuit pattern
  - [x] 1.5 Create `src/index.ts` with placeholder exports
  - [x] 1.6 Create `src/engine/` directory

- [x] Task 2: Type definitions (AC: 5)
  - [x] 2.1 Create `packages/pet-dvm/src/engine/types.ts`
  - [x] 2.2 Define `StatValues`, `PetEngineState`, `GameAction`, `InteractionResult`, `EvolutionResult`, `DecayResult`
  - [x] 2.3 Define `GameEngineError` class with error codes

- [x] Task 3: PetGameEngine class (AC: 1, 2, 3, 4, 9)
  - [x] 3.1 Create `packages/pet-dvm/src/engine/PetGameEngine.ts`
  - [x] 3.2 Implement constructor with state validation
  - [x] 3.3 Implement `processInteraction()` -- validates, computes decay, applies action, updates state
  - [x] 3.4 Implement `checkEvolution()` -- checks thresholds from EVOLUTION_THRESHOLDS
  - [x] 3.5 Implement `evolve()` -- applies stage transition with stat resets
  - [x] 3.6 Implement `applyDecayOnly()` -- read-only decay preview
  - [x] 3.7 Implement `getState()` -- readonly accessor
  - [x] 3.8 Implement `createPetGameEngine()` factory function
  - [x] 3.9 Implement `createGenesisState()` helper

- [x] Task 4: Package exports (AC: 8)
  - [x] 4.1 Update `packages/pet-dvm/src/index.ts` with all exports

- [x] Task 5: Golden vector cross-verification tests (AC: 6)
  - [x] 5.1 Create `packages/pet-dvm/src/engine/PetGameEngine.test.ts`
  - [x] 5.2 Load golden vectors from `../../pet-circuit/test-vectors/golden-vectors.json`
  - [x] 5.3 For each of 26 vectors: create engine, process action, assert exact match on decayed and final stats

- [x] Task 6: Unit tests (AC: 7)
  - [x] 6.1 Cooldown enforcement tests (allowed/blocked per stage)
  - [x] 6.2 Evolution threshold tests (egg->baby, baby->adult, meets/fails)
  - [x] 6.3 evolve() stat reset tests
  - [x] 6.4 Error handling tests (timestamp regression, invalid action, cooldown violation)
  - [x] 6.5 Sequential interaction test (5 interactions)
  - [x] 6.6 Stat clamping edge case tests
  - [x] 6.7 Shop item effect tests
  - [x] 6.8 Sleeping energy recovery test
  - [x] 6.9 Token cost mismatch test
  - [x] 6.10 Factory function validation tests (invalid stage, out-of-range stats)

- [x] Task 7: Verify build and lint (AC: 8)
  - [x] 7.1 Run `pnpm build` in pet-dvm -- TypeScript compiles cleanly
  - [x] 7.2 Run `pnpm test` in pet-dvm -- all tests pass
  - [x] 7.3 Run `pnpm lint` -- no lint errors (skipped; no eslint config in pet-dvm yet)

## Dev Notes

### Critical: Game Engine Must Match Circuit Exactly

The entire purpose of this story is to create a TypeScript game engine that produces **identical** outputs to the o1js PetLifecycle ZkProgram circuit for the same inputs. The golden test vectors (`packages/pet-circuit/test-vectors/golden-vectors.json`) are the authoritative test data. Any divergence is a P0 blocker.

The game engine does NOT duplicate the game rule constants or utility functions. It IMPORTS them from `@toon-protocol/pet-circuit`:

```typescript
import {
  computeDecay,
  applyAction,
  checkCooldown,
  isActionAllowed,
  getRequiredTokenCost,
  EVOLUTION_THRESHOLDS,
  ACTION_COUNT,
  Stage,
} from '@toon-protocol/pet-circuit';
```

This guarantees the engine uses the exact same decay rates, action effects, cooldowns, and thresholds as the circuit. The engine is a thin stateful wrapper around the circuit's utility functions.

### Error Wrapping: pet-circuit throws Error, game engine throws GameEngineError

The utility functions in pet-circuit (`checkCooldown`, `isActionAllowed`) throw plain `Error`, NOT `GameEngineError`. The game engine MUST catch these and re-throw as `GameEngineError` with the appropriate typed code. Suggested pattern for `processInteraction`:

```typescript
// 1. Check stage allowance FIRST (produces INVALID_ACTION code)
if (!isActionAllowed(action.actionType, this.state.stage)) {
  throw new GameEngineError(
    `Action ${action.actionType} not allowed for stage ${this.state.stage}`,
    'INVALID_ACTION'
  );
}

// 2. Check cooldown SECOND (produces COOLDOWN_ACTIVE code)
try {
  checkCooldown(action.actionType, this.state.stage, action.timestamp, this.state.cooldownTimestamps[action.actionType]!);
} catch {
  throw new GameEngineError(
    `Cooldown not elapsed for action ${action.actionType}`,
    'COOLDOWN_ACTIVE'
  );
}
```

Call `isActionAllowed` before `checkCooldown` because `checkCooldown` also throws for unavailable actions (cooldown=0 means infinite), but we want the `INVALID_ACTION` error code, not `COOLDOWN_ACTIVE`, when the action is stage-blocked.

### Stat Clamping: Use Inline Pattern, NOT clampStat from utils

The `clampStat` function exported from pet-circuit operates on o1js `UInt32` types (circuit-level). The game engine uses plain numbers. Use the inline pattern from `computeDecay`/`applyAction`: `Math.max(1, Math.min(100, value))`. Do NOT import `clampStat` from pet-circuit -- it will pull in o1js provable types at runtime.

### Package Structure

```
packages/pet-dvm/
  package.json
  tsconfig.json
  jest.config.js
  src/
    index.ts
    engine/
      types.ts
      PetGameEngine.ts
      PetGameEngine.test.ts
```

The `packages/pet-dvm/` package does NOT exist yet. This story creates it. Future stories (11-5, 11-6) will add DVM handler code, proof queue, and Mina TX broadcaster to this package.

### Why a New Package (pet-dvm) Instead of Adding to pet-circuit

The architecture spec (`pet-zkapp-integration-architecture.md` Section 4.2) defines three new packages:
- `@toon-protocol/memvid-node` -- napi-rs binding (Story 11-1, DONE)
- `@toon-protocol/pet-circuit` -- ZkProgram + SmartContract (Stories 11-2, 11-3, DONE)
- `@toon-protocol/pet-dvm` -- Pet DVM handler wrapping game engine + memvid + prover + Mina TX

The game engine belongs in `pet-dvm` because it is the runtime rule engine used by the DVM handler, NOT part of the o1js circuit. The circuit enforces rules at proof-generation time; the game engine applies them at request-handling time. They share the same constants but serve different purposes.

### Reuse Pattern: Import from pet-circuit, Don't Reimplement

The `utils.ts` in pet-circuit already has plain-TypeScript implementations of:
- `computeDecay(stats, stage, elapsedSeconds, isSleeping)` -- returns post-decay stats
- `applyAction(stats, actionType, itemId, stage)` -- returns post-action stats
- `checkCooldown(actionType, stage, currentTs, lastTs)` -- throws if cooldown not elapsed
- `isActionAllowed(actionType, stage)` -- returns boolean
- `blake3ToField(hexHash)` -- BLAKE3 hex to Mina Field (not needed in game engine directly)

These functions operate on plain numbers (not o1js Field/UInt types) and are already tested against the golden vectors in `PetLifecycle.test.ts`. The game engine calls them directly.

### Cooldown State Management

The game engine tracks cooldowns as a plain number array: `cooldownTimestamps: number[]` of length 11 (one per action type, matching `ACTION_COUNT`). Index corresponds to `ActionType` enum values (0=feed, 1=play, ..., 10=play_music).

When `processInteraction()` succeeds, it updates `cooldownTimestamps[action.actionType] = action.timestamp`.

This is the TypeScript equivalent of the circuit's `cooldownHash = Poseidon(timestamps)` approach, but using the raw array since we don't need Poseidon hashing outside the circuit.

### Evolution: Separate from Interaction

Per Story 11-3 debug learnings: `evolve()` does NOT increment cycle. Evolution proofs are separate steps in the ZkProgram. The game engine mirrors this:
1. `processInteraction()` -- advances cycle, applies decay + action
2. `checkEvolution()` -- readonly check, returns eligibility
3. `evolve()` -- applies stage transition, does NOT advance cycle

The DVM handler (Story 11-5) will call `checkEvolution()` after processing an interaction and, if eligible, call `evolve()` before the next interaction.

### Error Handling Pattern

The game engine throws `GameEngineError` with typed codes:

```typescript
class GameEngineError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_ACTION' | 'COOLDOWN_ACTIVE' | 'TIMESTAMP_REGRESSION' | 'EVOLUTION_NOT_READY' | 'INVALID_STAGE' | 'TOKEN_COST_MISMATCH'
  ) {
    super(message);
    this.name = 'GameEngineError';
  }
}
```

This allows the DVM handler to map error codes to appropriate ILP reject reasons.

### Jest Configuration (pet-dvm)

Follow the pet-circuit pattern exactly (see `packages/pet-circuit/jest.config.js`):
```javascript
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'pet-dvm',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  // o1js is ESM-native; allow transformation (needed because pet-circuit re-exports from o1js)
  transformIgnorePatterns: ['node_modules/(?!o1js/)'],
};
```

Key differences from pet-circuit: `displayName` is `'pet-dvm'`, `testTimeout` is 30000 (not 180000) since no o1js circuit compilation is needed. All other fields (`transform`, `transformIgnorePatterns`, `moduleFileExtensions`, `testMatch`) must match exactly or tests will fail to load pet-circuit imports.

### package.json (pet-dvm)

```json
{
  "name": "@toon-protocol/pet-dvm",
  "version": "0.1.0",
  "private": true,
  "description": "Pet DVM handler — game engine + memvid + prover + Mina TX for TOON pets",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "test:unit": "jest",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@toon-protocol/pet-circuit": "workspace:*"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=22.11.0"
  }
}
```

### tsconfig.json (pet-dvm)

**Do NOT extend root tsconfig.json.** The root tsconfig has `"noEmit": true` and `"module": "ESNext"` with `"moduleResolution": "bundler"`, which breaks `tsc` build output. pet-circuit uses a standalone tsconfig -- follow the same pattern:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

This matches `packages/pet-circuit/tsconfig.json` exactly, minus the `experimentalDecorators`/`emitDecoratorMetadata`/`useDefineForClassFields` flags which are only needed for o1js SmartContract decorators. pet-dvm does not use o1js directly, so these are omitted.

### What NOT to Build

- **ZK proof generation** -- Story 11-5 (Pet DVM Handler) manages the proof queue. The game engine has no o1js circuit dependency at runtime.
- **Memvid brain integration** -- Story 11-5. The game engine does not call `PetBrain.putBytes()` or `PetBrain.hash()`.
- **ILP/DVM handler** -- Story 11-5. No `createPetDvmHandler()` in this story.
- **Mina transaction submission** -- Story 11-5. No Mina GraphQL calls.
- **Kind 14919 event publishing** -- Story 11-5. No Nostr event construction.
- **PET token mechanics** -- Story 11-8. Token cost is tracked but not enforced on-chain.
- **Arweave checkpointing** -- Story 11-12. No Arweave upload.
- **Breeding** -- Story 11-13. No breed logic.

### Previous Story Learnings (from Stories 11-1, 11-2, 11-3)

1. **o1js v2.14.0 resolved:** pnpm resolves `^2.2.0` to 2.14.0. The pet-circuit utils work with plain numbers, so o1js version is not a direct concern for the game engine (it only imports constants and plain-number utility functions).
2. **jest.config.js not .ts:** ts-node is not installed. Use `module.exports = { ... }` in a `.js` file.
3. **`transformIgnorePatterns: ['node_modules/(?!o1js/)']`:** Required because pet-circuit re-exports from o1js. The game engine's test suite will load pet-circuit which loads o1js, so the transform pattern is needed.
4. **Evolution does NOT increment cycle:** Confirmed in Story 11-3 debug log. The game engine must mirror this behavior.
5. **`computeDecay` uses pre-decay stats for egg happiness conditions:** Per `utils.ts` lines 158-167, egg happiness rate is based on pre-decay health and hygiene values, but health penalties use post-decay hygiene. The game engine inherits this behavior by calling `computeDecay` directly.
6. **Stat floor is 1, not 0:** All stats clamp to [1, 100]. `clampStat` returns `max(1, min(100, value))`.
7. **Golden vectors are canonical:** The 26 vectors in `golden-vectors.json` were validated against both the reference TypeScript implementation and the o1js circuit in Story 11-2. Any divergence in the game engine is a bug in the game engine.

### Quality Gates (from Test Design)

| Gate | Test | Blocking? |
|------|------|-----------|
| Golden vector cross-verification (26 vectors) | AC-6 | Yes -- P0 blocker. Divergence = game engine bug |
| Cooldown enforcement (33 combinations) | AC-7 | Yes -- blocks DVM handler (Story 11-5) |
| Evolution thresholds correct | AC-7 | Yes -- blocks evolution flow in DVM |
| Sequential interactions update state correctly | AC-7 | Yes -- blocks multi-interaction batching |
| Token cost validation correct | AC-7 | Yes -- prevents free shop item exploits |
| Factory validation rejects bad state | AC-7 | Yes -- prevents corrupted initial state |

### Risk Mitigations

| Risk | Score | Mitigation |
|------|-------|------------|
| R-004: Decay arithmetic diverges from circuit | 6 | Game engine calls `computeDecay` from pet-circuit directly -- same function, same constants. Golden vector cross-verification catches any import/usage errors. |
| R-020: Cooldown bypass via manipulated timestamps | 6 | Game engine enforces timestamp monotonicity (`timestamp > lastInteraction` assertion). Cooldown check uses same `checkCooldown` function as circuit. |
| Dependency on pet-circuit internals | Low | Game engine imports only from the public API (`index.ts` exports). All needed functions and constants are already exported. |
| Pet-dvm package creation conflicts with monorepo | Low | Follow the exact same patterns as pet-circuit for package.json, tsconfig.json, jest.config.js. Check pnpm workspace config. |

### Project Structure Notes

- **New package:** `packages/pet-dvm/` (does not exist yet, created by this story)
- **Workspace config:** Check `pnpm-workspace.yaml` to ensure `packages/pet-dvm` is included in the workspace glob. If it uses `packages/*`, it will be auto-discovered.
- **No changes to pet-circuit:** The game engine only reads from pet-circuit exports. No modifications needed.
- **File naming:** Follow pet-circuit conventions: PascalCase for classes (`PetGameEngine.ts`), camelCase for utilities, `.test.ts` suffix for tests

### References

- [Source: _bmad-output/planning-artifacts/pet-zkapp-game-rules-canonical.md] -- Canonical game rules: stat system, decay rates, action effects, cooldowns, evolution thresholds
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#Package-Dependency-Map] -- Package structure: pet-dvm wraps game engine + memvid + prover
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#Handler-Internal-Flow] -- DVM handler flow showing game engine usage (Steps 2-7)
- [Source: _bmad-output/planning-artifacts/pet-zkapp-integration-architecture.md#Enforcement-Boundaries] -- What game engine enforces vs what circuit enforces
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#Story-11-4] -- Test strategy: 33 decay tests, 11 cooldowns, 6 evolution, 4 stage restrictions, 5 property, 33 cross-verify
- [Source: _bmad-output/planning-artifacts/pet-zkapp-blake3-hashing-spec.md] -- BLAKE3-to-Field conversion (reference, not directly used by game engine)
- [Source: packages/pet-circuit/src/constants.ts] -- All game constants: ActionType, Stage, DECAY_RATES, COOLDOWN_DURATIONS, BASE_ACTION_EFFECTS, SHOP_ITEMS, EVOLUTION_THRESHOLDS
- [Source: packages/pet-circuit/src/utils.ts] -- Reference implementations: computeDecay, applyAction, checkCooldown, isActionAllowed
- [Source: packages/pet-circuit/src/structs.ts] -- PetStats, PetAction, PetState struct definitions (circuit types, not used directly by game engine)
- [Source: packages/pet-circuit/test-vectors/golden-vectors.json] -- 26 golden test vectors for cross-verification
- [Source: packages/pet-circuit/package.json] -- Package config pattern to follow for pet-dvm
- [Source: packages/pet-circuit/jest.config.js] -- Jest config pattern to follow
- [Source: _bmad-output/implementation-artifacts/11-3-pet-zkapp-smartcontract.md] -- Previous story: evolution does NOT increment cycle, o1js quirks
- [Source: _bmad-output/implementation-artifacts/11-2-pet-lifecycle-zkprogram.md] -- Previous story: golden vectors created, utils functions tested

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — claude-opus-4-6[1m]

### Debug Log References

None — implementation was straightforward with no debugging needed.

### Completion Notes List

- **Task 1 (Package setup):** Package structure, `package.json`, `tsconfig.json`, `jest.config.js`, `src/index.ts`, and `src/engine/` directory were already created in a prior ATDD RED phase. Verified all configs match the story spec exactly.
- **Task 2 (Type definitions):** `types.ts` with `StatValues`, `PetEngineState`, `GameAction`, `InteractionResult`, `EvolutionResult`, `DecayResult`, `GameEngineErrorCode`, and `GameEngineError` class were already created in the RED phase. No changes needed.
- **Task 3 (PetGameEngine class):** Implemented the full `PetGameEngine` class replacing RED-phase stubs. `processInteraction()` validates timestamp monotonicity, stage allowance, cooldown, and token cost before computing decay and applying action effects — all via imported pet-circuit utility functions. `checkEvolution()` checks HATCH/EVOLVE thresholds. `evolve()` applies stage transitions with correct stat resets (egg->baby resets to 100 except health; baby->adult inherits all). `applyDecayOnly()` provides read-only decay preview. `createPetGameEngine()` factory validates stage and stat ranges. `createGenesisState()` returns default state.
- **Task 4 (Package exports):** `src/index.ts` already exports all types and classes correctly from the RED phase.
- **Task 5 (Golden vector cross-verification):** All 26 golden vectors from `pet-circuit/test-vectors/golden-vectors.json` pass — post-decay and post-action stats match exactly.
- **Task 6 (Unit tests):** All 90 tests pass: 33 cooldown enforcement combinations (3 stages x 11 actions), evolution threshold checks, evolve() stat resets, error handling (TIMESTAMP_REGRESSION, INVALID_ACTION, COOLDOWN_ACTIVE, TOKEN_COST_MISMATCH, EVOLUTION_NOT_READY), 5 sequential interactions, stat clamping boundaries, 2 shop items, sleeping energy recovery, and factory validation.
- **Task 7 (Build/lint):** `pnpm build` compiles cleanly with zero errors. `pnpm test` passes all 90 tests in 1.4s. Lint skipped (no eslint config in pet-dvm yet — will be added in a future story).

### File List

- `packages/pet-dvm/src/engine/PetGameEngine.ts` — **modified** (replaced stubs with full implementation)
- `packages/pet-dvm/src/engine/types.ts` — unchanged (created in RED phase)
- `packages/pet-dvm/src/engine/PetGameEngine.test.ts` — unchanged (created in RED phase)
- `packages/pet-dvm/src/index.ts` — unchanged (created in RED phase)
- `packages/pet-dvm/package.json` — unchanged (created in RED phase)
- `packages/pet-dvm/tsconfig.json` — unchanged (created in RED phase)
- `packages/pet-dvm/jest.config.js` — unchanged (created in RED phase)
- `_bmad-output/implementation-artifacts/11-4-pet-game-engine.md` — **modified** (status, tasks, dev agent record)

### Change Log

| Date | Summary |
|------|---------|
| 2026-04-07 | GREEN phase: Implemented PetGameEngine class with processInteraction, checkEvolution, evolve, applyDecayOnly, createPetGameEngine factory, and createGenesisState. All 90 ATDD tests pass including 26 golden vector cross-verifications. Build clean. |

## Code Review Record

| Pass | Date | Reviewer | Critical | High | Medium | Low | Outcome |
|------|------|----------|----------|------|--------|-----|---------|
| 1 | 2026-04-07 | Claude Opus 4.6 | 0 | 0 | 0 | 4 | **Pass** — all 4 low-severity issues fixed |
| 2 | 2026-04-07 | Claude Opus 4.6 | 0 | 0 | 0 | 2 | **Pass** — all 2 low-severity issues fixed |
| 3 | 2026-04-07 | Claude Opus 4.6 | 0 | 0 | 0 | 4 | **Pass (final)** — all 4 low-severity issues fixed |

### Review Pass #1 Details

**Reviewer:** Claude Opus 4.6 (claude-opus-4-6[1m])
**Date:** 2026-04-07
**Outcome:** Pass (0 Critical, 0 High, 0 Medium, 4 Low — all fixed)

**Low-severity issues identified and fixed:**
1. Factory cooldown timestamp validation — added validation for cooldown timestamp values
2. Factory lastInteraction validation — added validation for lastInteraction field
3. Factory brainHash format validation — added validation for brainHash format
4. applyDecayOnly isSleeping parameter — corrected isSleeping parameter handling

### Review Pass #2 Details

**Reviewer:** Claude Opus 4.6 (claude-opus-4-6[1m])
**Date:** 2026-04-07
**Outcome:** Pass (0 Critical, 0 High, 0 Medium, 2 Low — all fixed)

**Low-severity issues identified and fixed:**
1. Weak stat floor clamping test assertion — strengthened to exact value check
2. Weak stat ceiling clamping test assertion — strengthened to exact value check

### Review Pass #3 Details

**Reviewer:** Claude Opus 4.6 (claude-opus-4-6[1m])
**Date:** 2026-04-07
**Outcome:** Pass — final (0 Critical, 0 High, 0 Medium, 4 Low — all fixed)

**Low-severity issues identified and fixed:**
1. GameEngineError prototype chain broken — fixed prototype chain setup
2. Missing itemId input validation — added validation for itemId parameter
3. Uncaught plain Error from getRequiredTokenCost — wrapped in GameEngineError
4. Uncaught plain Error from applyAction — wrapped in GameEngineError
