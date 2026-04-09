# Story 11.15: Dungeon Engine Core

Status: ready-for-dev
ui_impact: false

## Story

As a TOON Protocol developer,
I want a headless, deterministic `DungeonGameEngine` class in `@toon-protocol/pet-dvm` that uses rot.js to procedurally generate dungeons and simulate turn-based dungeon runs given a seed and pet stats,
so that downstream stories (11-16, 11-17) can compose the engine into a DVM compute handler with verified, reproducible outcomes that are ZK-compatible.

## Dependencies

- **Upstream:** Story 11-4 (Pet Game Engine) — `PetEngineState`, `StatValues`, `PetGameEngine` class patterns established. Engine lives in `packages/pet-dvm/src/engine/`. DONE.
- **Upstream:** Story 11-5 (Pet DVM Handler) — `packages/pet-dvm` package structure, Jest test runner, tsconfig, patterns for engine modules. DONE.
- **External:** `rot-js` npm package (BSD-3, TypeScript, ~2,700 stars) — **NOT YET INSTALLED** in `packages/pet-dvm`. Must be added via `pnpm --filter @toon-protocol/pet-dvm add rot-js`.
- **Downstream:** Story 11-16 (Pet-Dungeon Stat Bridge) — imports `DungeonGameEngine`, `DungeonRunResult`, `DungeonConfig` from this story.
- **Downstream:** Story 11-17 (Dungeon DVM Handler) — wraps `DungeonGameEngine` in kind:5250 DVM handler.

## Acceptance Criteria

1. **AC-1 — rot.js installed:** `rot-js` is listed in `packages/pet-dvm/package.json` `dependencies`. `pnpm --filter @toon-protocol/pet-dvm build` compiles cleanly with the import.

2. **AC-2 — DungeonGameEngine class:** A `DungeonGameEngine` class in `packages/pet-dvm/src/dungeon/DungeonGameEngine.ts`:
   - Constructor: `new DungeonGameEngine(config: DungeonConfig)`
   - Method: `run(seed: string, petStats: DungeonPetStats): DungeonRunResult`
   - The `run()` method is deterministic: identical `seed` + `petStats` → identical `DungeonRunResult` across all invocations
   - Headless: zero DOM/Canvas/window dependencies — pure Node.js

3. **AC-3 — DungeonConfig type:** `packages/pet-dvm/src/dungeon/types.ts` defines `DungeonConfig`:
   - `width`: number (dungeon grid width, default 40)
   - `height`: number (dungeon grid height, default 30)
   - `maxRooms`: number (max rooms to generate, default 8)
   - `dungeonType`: `'digger' | 'cellular' | 'rogue'` (rot.js generator type, default 'digger')
   - `monsterTable`: `MonsterEntry[]` — array of `{ id: string; name: string; minFloor: number; basePower: number; baseHp: number }`
   - `lootTable`: `LootEntry[]` — array of `{ id: string; name: string; rarity: number; statDelta: Partial<DungeonStatDelta> }`

4. **AC-4 — DungeonPetStats type:** `packages/pet-dvm/src/dungeon/types.ts` defines `DungeonPetStats`:
   - `hunger`: number (1–100)
   - `happiness`: number (1–100)
   - `health`: number (1–100)
   - `hygiene`: number (1–100)
   - `energy`: number (1–100)

5. **AC-5 — DungeonRunResult type:** `packages/pet-dvm/src/dungeon/types.ts` defines `DungeonRunResult`:
   - `seed`: string — the seed used (echoed back)
   - `dungeonType`: string — which generator was used
   - `roomsGenerated`: number — total rooms in the dungeon
   - `roomsVisited`: number — rooms the pet traversed
   - `floorsReached`: number — depth reached (1-indexed)
   - `encounters`: `EncounterRecord[]` — array of `{ monsterId: string; monsterName: string; petWon: boolean; damageDealt: number; damageTaken: number }`
   - `lootFound`: `LootRecord[]` — array of `{ itemId: string; itemName: string; rarity: number }`
   - `statDeltas`: `DungeonStatDelta` — net stat changes from the run (to be applied to pet by Story 11-16)
   - `narrativeSummary`: string — a short human-readable summary (e.g., "Fluffy reached floor 3, defeated 2 monsters, and found a Health Potion")
   - `durationMs`: number — how long the simulation took in milliseconds

6. **AC-6 — DungeonStatDelta type:** `packages/pet-dvm/src/dungeon/types.ts` defines `DungeonStatDelta`:
   - `hunger`: number — change to hunger stat (negative = spent energy, positive = found food)
   - `happiness`: number — change to happiness (positive from victory/loot)
   - `health`: number — change to health (negative from damage, positive from healing loot)
   - `hygiene`: number — change to hygiene (negative from dungeon combat)
   - `energy`: number — change to energy (negative from exploration)

7. **AC-7 — Dungeon generation using rot.js:** `DungeonGameEngine.run()` uses `ROT.Map.Digger` (or Cellular/Rogue based on `config.dungeonType`) to procedurally generate the map. The rot.js RNG is seeded from the `seed` string (converted to a numeric seed via deterministic hash). The generated dungeon map is valid: all rooms are reachable from the start position.

8. **AC-8 — Pet traversal simulation:** The engine simulates a simplified turn-based idle dungeon run:
   - Pet starts in room 1 (starting room)
   - Pet advances room-by-room until energy runs out or no more rooms exist
   - Each room may have 0–2 monsters (based on `monsterTable` and seeded RNG)
   - Each monster encounter resolves via `resolveCombat(petStats, monster, rng)` — pure function
   - After encounters, pet may find loot (based on `lootTable` and seeded RNG)
   - Stat deltas accumulate across all rooms

9. **AC-9 — Combat resolution:** `resolveCombat(petStats: DungeonPetStats, monster: MonsterEntry, rng: ROT.RNG): CombatResult` (internal function, not exported):
   - Pet combat power: `Math.floor(petStats.hunger * 0.5 + petStats.energy * 0.3 + 1)` (simplified — will be overridden by bridge in 11-16)
   - Monster HP: `monster.baseHp`
   - Combat runs in rounds; each round: pet deals `petPower * rng.getUniform() * 2` damage, monster deals `monster.basePower * rng.getUniform()` damage
   - Combat ends when pet HP (derived from `petStats.health`) or monster HP reaches 0
   - Returns `CombatResult: { petWon: boolean; damageDealt: number; damageTaken: number }`

10. **AC-10 — Loot resolution:** After each room's encounters (win or partial), loot roll: `rng.getUniform() < lootChance`. If true, pick item from `lootTable` weighted by `rarity`. Loot item's `statDelta` is accumulated into the run's `statDeltas`. Loot items with `rarity > 0.8` are "rare" — count toward `narrativeSummary`.

11. **AC-11 — Determinism test (P0 gate):** `packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts` must include:
    - At minimum 4 tests: run the same `(seed, petStats)` pair 100 times with freshly constructed engines and assert each `DungeonRunResult` is deeply equal
    - Must use 4 different seeds to cover different dungeon shapes
    - This is the critical quality gate (G17 from test-design-epic-11.md)

12. **AC-12 — Unit tests — dungeon generation:** ≥ 6 tests covering:
    - Digger, Cellular, Rogue layouts each produce `roomsGenerated >= 1`
    - Generated map has start position accessible
    - `roomsGenerated` matches rot.js map output
    - Invalid dungeon type throws `DungeonEngineError` with code `INVALID_CONFIG`

13. **AC-13 — Unit tests — encounter resolution:** ≥ 8 tests covering:
    - Pet with high stats defeats weak monster
    - Pet with low energy gets reduced combat power
    - Loot is seeded-deterministic (same RNG state → same loot)
    - `statDeltas.health` decreases when pet takes damage
    - `statDeltas.happiness` increases when pet wins encounters
    - `encounters` array length matches number of monsters spawned

14. **AC-14 — Unit tests — loot and narrative:** ≥ 4 tests covering:
    - Loot rolls produce items from configured `lootTable`
    - `narrativeSummary` is non-empty string
    - `narrativeSummary` includes `roomsVisited` count
    - `durationMs` is a positive number

15. **AC-15 — Property/fuzz tests:** ≥ 3 tests:
    - 50 random seeds never produce `roomsGenerated = 0`
    - `floorsReached` is always ≥ 1 and ≤ `roomsGenerated`
    - `statDeltas` values are finite numbers (no NaN/Infinity)

16. **AC-16 — Benchmark test:** 1 test: `DungeonGameEngine.run()` with default config completes in < 50ms on a single run (use `Date.now()` delta; warn but do not fail if > 50ms in CI).

17. **AC-17 — DungeonEngineError:** `packages/pet-dvm/src/dungeon/types.ts` exports `DungeonEngineError extends Error` with `code: DungeonEngineErrorCode` field. `DungeonEngineErrorCode = 'INVALID_CONFIG' | 'INVALID_SEED' | 'EMPTY_MONSTER_TABLE' | 'EMPTY_LOOT_TABLE'`.

18. **AC-18 — Package exports:** All public types and the `DungeonGameEngine` class are exported from `packages/pet-dvm/src/index.ts`.

19. **AC-19 — Build verification:** `pnpm --filter @toon-protocol/pet-dvm build` compiles with zero TypeScript errors.

20. **AC-20 — Test verification:** `pnpm --filter @toon-protocol/pet-dvm test` runs all tests (engine + dungeon) with all passing.

## Tasks / Subtasks

- [ ] Task 1: Install rot-js dependency (AC: 1)
  - [ ] 1.1 Run `pnpm --filter @toon-protocol/pet-dvm add rot-js` from project root
  - [ ] 1.2 Verify `rot-js` appears in `packages/pet-dvm/package.json` `dependencies`
  - [ ] 1.3 Verify `import { RNG, Map as ROTMap } from 'rot-js'` compiles cleanly

- [ ] Task 2: Define dungeon types (AC: 3, 4, 5, 6, 17)
  - [ ] 2.1 Create `packages/pet-dvm/src/dungeon/types.ts` with `DungeonConfig`, `DungeonPetStats`, `DungeonRunResult`, `DungeonStatDelta`, `EncounterRecord`, `LootRecord`, `MonsterEntry`, `LootEntry`, `DungeonEngineError`, `DungeonEngineErrorCode`

- [ ] Task 3: Implement DungeonGameEngine (AC: 2, 7, 8, 9, 10)
  - [ ] 3.1 Create `packages/pet-dvm/src/dungeon/DungeonGameEngine.ts`
  - [ ] 3.2 Implement constructor with `DungeonConfig` validation (throw `DungeonEngineError` for invalid config)
  - [ ] 3.3 Implement `run(seed: string, petStats: DungeonPetStats): DungeonRunResult`
  - [ ] 3.4 Implement seed-to-RNG conversion (deterministic string → numeric seed via simple hash)
  - [ ] 3.5 Implement dungeon generation (rot.js Digger/Cellular/Rogue selection)
  - [ ] 3.6 Implement room traversal simulation with monster spawning
  - [ ] 3.7 Implement `resolveCombat()` internal function
  - [ ] 3.8 Implement loot roll logic
  - [ ] 3.9 Implement `narrativeSummary` generation
  - [ ] 3.10 Create default monster table (3–5 monsters) and loot table (3–5 items) as `DEFAULT_MONSTER_TABLE` and `DEFAULT_LOOT_TABLE` constants

- [ ] Task 4: Write tests (AC: 11–16)
  - [ ] 4.1 Create `packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts`
  - [ ] 4.2 Implement 4× determinism tests (100 iterations each, 4 seeds)
  - [ ] 4.3 Implement ≥ 6 dungeon generation unit tests (Digger/Cellular/Rogue/invalid)
  - [ ] 4.4 Implement ≥ 8 encounter resolution tests
  - [ ] 4.5 Implement ≥ 4 loot and narrative tests
  - [ ] 4.6 Implement ≥ 3 property/fuzz tests
  - [ ] 4.7 Implement 1 benchmark test (< 50ms)

- [ ] Task 5: Update package exports (AC: 18)
  - [ ] 5.1 Add dungeon exports to `packages/pet-dvm/src/index.ts`

- [ ] Task 6: Build and test verification (AC: 19, 20)
  - [ ] 6.1 `pnpm --filter @toon-protocol/pet-dvm build` — must pass
  - [ ] 6.2 `pnpm --filter @toon-protocol/pet-dvm test` — must pass

## Dev Notes

### Architecture & Design Philosophy

Story 11-15 introduces the `dungeon/` sub-module inside `packages/pet-dvm/src/`, alongside the existing `engine/`, `handler/`, `checkpoint/`, and `pricing/` directories. The pattern follows the **Slay the Web action/state model** (decision D11-PM-008): `action(state) → newState` pure functions, which map 1:1 to ZK state transitions.

The critical constraint is **determinism**: the same `(seed, petStats)` input MUST always produce the same `DungeonRunResult`. This is requirement G17 (test-design-epic-11.md) and is the P0 quality gate for this story. rot.js's seedable RNG makes this tractable — the entire run shares a single RNG instance created from the seed.

This story does NOT:
- Map pet stats to dungeon modifiers (that's Story 11-16, Pet-Dungeon Stat Bridge)
- Integrate with PetGameEngine or apply stat deltas back (that's Story 11-16/11-17)
- Wrap the engine in a DVM handler (that's Story 11-17)
- Store adventure logs on Arweave (that's Story 11-18)
- Have any UI or Nostr event output

### rot.js API Patterns

rot.js exports are ESM/CJS-compatible. Key APIs:

```typescript
import { RNG, Map as ROTMap } from 'rot-js';

// Seed the RNG (must call before using)
RNG.setSeed(numericSeed);

// Generate dungeon with Digger algorithm
const dungeon = new ROTMap.Digger(width, height);
const passable: Map<string, boolean> = new Map();
dungeon.create((x, y, isWall) => {
  if (!isWall) passable.set(`${x},${y}`, true);
});

// Get rooms
const rooms = dungeon.getRooms(); // Array of Room objects

// RNG for per-encounter decisions
const roll = RNG.getUniform(); // [0, 1)
const intRoll = RNG.getUniformInt(1, 6); // integer in [1, 6]
```

**CRITICAL:** rot.js uses a **global** singleton `RNG` with `setSeed()`. To guarantee determinism across independent `run()` calls, always call `RNG.setSeed(numericSeed)` at the very start of `run()`. This resets the global RNG state. Because the DungeonGameEngine operates in a single-threaded Node.js environment (DVM handler), sequential calls are safe — but never call `run()` concurrently.

**Headless verification:** rot.js `Map.*` generators work without DOM. Do NOT import `ROT.Display` or `ROT.FOV` (those may assume Canvas in some environments). The map generators (`Digger`, `Cellular`, `Rogue`), `ROT.RNG`, and `ROT.Path.AStar` are all safe.

### Seed String to Numeric Seed

rot.js `RNG.setSeed()` takes a number. Convert the seed string with a simple deterministic hash:

```typescript
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}
```

This produces a stable 32-bit integer from any string. Must be called in `run()` before any rot.js operations.

### TypeScript Strict Mode Notes

`packages/pet-dvm` uses `strict: true` + `noUncheckedIndexedAccess: true` + `noPropertyAccessFromIndexSignature: true`. Key implications:

- Array access `arr[i]` returns `T | undefined` — always guard with `?? fallback` or runtime check
- Use `const rooms = dungeon.getRooms() ?? []` pattern
- Monster/loot table access: `config.monsterTable[idx]` → check for undefined before using
- rot.js types: install `@types/rot-js` if rot-js ships without bundled types, OR verify rot-js ships its own `.d.ts` (it does as of v2.2+)

### Default Tables (for testing and standalone use)

Provide exported constants alongside the engine class:

```typescript
export const DEFAULT_MONSTER_TABLE: MonsterEntry[] = [
  { id: 'slime',  name: 'Slime',       minFloor: 1, basePower: 5,  baseHp: 20 },
  { id: 'goblin', name: 'Goblin',      minFloor: 1, basePower: 8,  baseHp: 30 },
  { id: 'orc',    name: 'Orc',         minFloor: 2, basePower: 12, baseHp: 50 },
  { id: 'troll',  name: 'Cave Troll',  minFloor: 3, basePower: 18, baseHp: 80 },
  { id: 'dragon', name: 'Mini Dragon', minFloor: 4, basePower: 25, baseHp: 120 },
];

export const DEFAULT_LOOT_TABLE: LootEntry[] = [
  { id: 'health_potion', name: 'Health Potion', rarity: 0.6, statDelta: { health: 15 } },
  { id: 'energy_drink',  name: 'Energy Drink',  rarity: 0.5, statDelta: { energy: 10 } },
  { id: 'berry',         name: 'Sweet Berry',   rarity: 0.7, statDelta: { hunger: 8, happiness: 5 } },
  { id: 'soap',          name: 'Travel Soap',   rarity: 0.4, statDelta: { hygiene: 12 } },
  { id: 'trophy',        name: 'Monster Trophy',rarity: 0.2, statDelta: { happiness: 20 } },
];
```

### Pet Energy and Dungeon Depth

Energy drives exploration depth. Per decision D11-PM-002, energy maps to "exploration range." Simple model for the MVP:

- Base rooms per run: `Math.floor(petStats.energy / 20)` clamped to `[1, config.maxRooms]`
- This is the "intended" depth before any combat losses
- Combat damage can cut the run short (pet flees if health-derived HP reaches 0)

### StatDelta Accumulation

`DungeonStatDelta` accumulates throughout the run. Starting deltas: all zeros. Per room:
- Each monster encounter: `statDeltas.health -= damageTaken`, `statDeltas.happiness += petWon ? 5 : 0`, `statDeltas.energy -= 3`, `statDeltas.hygiene -= 2`
- Each loot found: apply loot's `statDelta` to accumulator
- At end: `statDeltas.energy -= roomsVisited * 2` (exploration cost)
- `statDeltas.hunger -= Math.floor(roomsVisited * 1.5)` (hunger from exertion)

Story 11-16 will override/augment these mappings with proper pet-stat-to-modifier scaling. For this story, the values are approximate and will be tested for staying within reasonable bounds.

### Testing Pattern

`packages/pet-dvm` uses **Jest** (not Vitest) with `ts-jest`. Existing pattern: see `packages/pet-dvm/src/engine/PetGameEngine.test.ts`. Tests import from relative paths. Use `describe`/`it`/`expect` Jest API.

**Do NOT** use `import goldenVectors from 'pet-circuit/...'` — dungeon tests are fully self-contained.

For determinism tests (100 iterations), keep them fast by using a simple seed like `'test-seed-1'` — rot.js generation on a 40×30 grid typically takes < 5ms.

For fuzz tests (50 random seeds), generate seeds with `Array.from({length:50}, (_, i) => \`seed-${i}\`)`.

### Project Structure Notes

New files live in `packages/pet-dvm/src/dungeon/`:
- `types.ts` — all dungeon type definitions
- `DungeonGameEngine.ts` — engine class + default tables
- `DungeonGameEngine.test.ts` — test file (excluded from tsconfig `include`, same as existing tests)

These follow the exact same structure as `packages/pet-dvm/src/engine/`:
```
packages/pet-dvm/src/
├── engine/         ← existing (PetGameEngine)
│   ├── PetGameEngine.ts
│   ├── PetGameEngine.test.ts
│   └── types.ts
├── dungeon/        ← NEW (Story 11-15)
│   ├── DungeonGameEngine.ts
│   ├── DungeonGameEngine.test.ts
│   └── types.ts
├── handler/        ← existing
├── checkpoint/     ← existing
├── pricing/        ← existing
└── index.ts        ← export dungeon symbols here
```

### References

- [Source: _bmad-output/planning-artifacts/research/party-mode-dungeon-engine-decisions-2026-04-08.md] — D11-PM-001 through D11-PM-010, rot.js decision rationale, Slay the Web pattern
- [Source: _bmad-output/project-context.md#343-358] — Living Dungeon architecture, stat-to-modifier mapping overview, idle dungeon MVP definition
- [Source: _bmad-output/planning-artifacts/test-design-epic-11.md#Story-11-15] — Test strategy: 6 unit (gen) + 4 determinism + 8 encounter + 4 loot + 3 property + 1 benchmark; Quality gate G16/G17; Risks R-023/R-024
- [Source: packages/pet-dvm/src/engine/PetGameEngine.ts] — Engine class pattern to follow
- [Source: packages/pet-dvm/src/engine/types.ts] — Type definition pattern, GameEngineError pattern to replicate for DungeonEngineError
- [Source: packages/pet-dvm/tsconfig.json] — strict + noUncheckedIndexedAccess + commonjs module
- [Source: packages/pet-dvm/package.json] — Jest test runner (not Vitest), ts-jest

## Code Review Record

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-04-09: Story 11-15 created and ready for development.
