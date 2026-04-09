---
stepsCompleted: [preflight, context, test-design, test-creation]
lastStep: 'test-creation'
lastSaved: '2026-04-09'
workflowType: 'testarch-atdd'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-15-dungeon-engine-core.md'
---

# ATDD Checklist - Epic 11, Story 11-15: Dungeon Engine Core

**Date:** 2026-04-09
**Author:** TEA Agent
**Primary Test Level:** Unit (pure engine, no HTTP/Nostr/IO)

---

## Story Summary

A headless, deterministic `DungeonGameEngine` class in `@toon-protocol/pet-dvm` that uses rot.js to procedurally generate dungeons and simulate turn-based dungeon runs given a seed and pet stats. Downstream stories (11-16, 11-17) compose this engine into a DVM compute handler with verified, reproducible outcomes that are ZK-compatible.

**As a** TOON Protocol developer
**I want** a headless, deterministic DungeonGameEngine class using rot.js
**So that** downstream stories can compose the engine into a DVM compute handler with verified, reproducible, ZK-compatible outcomes

---

## Acceptance Criteria

1. AC-1: `rot-js` listed in `packages/pet-dvm/package.json` dependencies
2. AC-2: `DungeonGameEngine` class with constructor `(config: DungeonConfig)` and method `run(seed, petStats): DungeonRunResult`; deterministic; headless
3. AC-3: `DungeonConfig` type with `width`, `height`, `maxRooms`, `dungeonType`, `monsterTable`, `lootTable`
4. AC-4: `DungeonPetStats` type with `hunger`, `happiness`, `health`, `hygiene`, `energy`
5. AC-5: `DungeonRunResult` type with `seed`, `dungeonType`, `roomsGenerated`, `roomsVisited`, `floorsReached`, `encounters`, `lootFound`, `statDeltas`, `narrativeSummary`, `durationMs`
6. AC-6: `DungeonStatDelta` type with all five stat fields
7. AC-7: Dungeon generation using rot.js Digger/Cellular/Rogue based on config; RNG seeded from seed string; valid reachable map
8. AC-8: Pet traversal simulation — room-by-room, energy-limited, monster spawning, combat, loot accumulation
9. AC-9: `resolveCombat()` internal function with power formula, round-based combat, returns `CombatResult`
10. AC-10: Loot resolution — roll check, weighted pick by rarity, `statDelta` accumulation
11. AC-11: Determinism tests — 4 seeds × 100 iterations each, deeply equal results
12. AC-12: Dungeon generation unit tests (≥ 6)
13. AC-13: Encounter resolution unit tests (≥ 8)
14. AC-14: Loot and narrative unit tests (≥ 4)
15. AC-15: Property/fuzz tests (≥ 3)
16. AC-16: Benchmark test (< 50ms)
17. AC-17: `DungeonEngineError extends Error` with `code: DungeonEngineErrorCode`
18. AC-18: All public types and class exported from `packages/pet-dvm/src/index.ts`
19. AC-19: Build passes with zero TypeScript errors
20. AC-20: All tests pass

---

## Failing Tests Created (RED Phase)

### Unit Tests (26+ tests)

**File:** `packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts`

#### Determinism Tests (AC-11)

- **Test:** determinism — seed 'test-seed-1' produces identical results 100 times
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-11, AC-2, G17 quality gate

- **Test:** determinism — seed 'dungeon-alpha-42' produces identical results 100 times
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-11 with different dungeon shape

- **Test:** determinism — seed 'fluffy-runs-deep' produces identical results 100 times
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-11, varied room count

- **Test:** determinism — seed '0xDEADBEEF' produces identical results 100 times
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-11, hex-like seed

#### Dungeon Generation Tests (AC-12)

- **Test:** Digger dungeon produces roomsGenerated >= 1
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-7, AC-12

- **Test:** Cellular dungeon produces roomsGenerated >= 1
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-7, AC-12

- **Test:** Rogue dungeon produces roomsGenerated >= 1
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-7, AC-12

- **Test:** Generated Digger map has accessible start position
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-7 (valid map)

- **Test:** roomsGenerated matches rot.js getRooms() output length
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-12

- **Test:** Invalid dungeonType 'maze' throws DungeonEngineError with code INVALID_CONFIG
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-12, AC-17

#### Encounter Resolution Tests (AC-13)

- **Test:** Pet with high stats (all 80+) defeats a Slime (low power)
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-9, AC-13

- **Test:** Pet with low energy (energy=5) has reduced combat power
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-9 formula, AC-13

- **Test:** Loot rolls are seeded-deterministic (same RNG state → same loot)
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-10, AC-13

- **Test:** statDeltas.health decreases when pet takes damage
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-8 stat accumulation, AC-13

- **Test:** statDeltas.happiness increases when pet wins encounters
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-8 stat accumulation, AC-13

- **Test:** encounters array length matches number of monsters spawned
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-5, AC-13

- **Test:** Empty monsterTable throws DungeonEngineError with code EMPTY_MONSTER_TABLE
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-17, AC-13

- **Test:** Empty lootTable throws DungeonEngineError with code EMPTY_LOOT_TABLE
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-17, AC-13

#### Loot and Narrative Tests (AC-14)

- **Test:** Loot rolls produce items from configured lootTable
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-10, AC-14

- **Test:** narrativeSummary is a non-empty string
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-5, AC-14

- **Test:** narrativeSummary includes roomsVisited count
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-5, AC-14

- **Test:** durationMs is a positive number
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-5, AC-14

#### Property / Fuzz Tests (AC-15)

- **Test:** 50 random seeds never produce roomsGenerated = 0
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-15

- **Test:** floorsReached is always >= 1 and <= roomsGenerated
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-15

- **Test:** statDeltas values are finite numbers (no NaN/Infinity)
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-15

#### Benchmark Test (AC-16)

- **Test:** run() with default config completes in < 50ms
  - **Status:** RED - DungeonGameEngine does not exist
  - **Verifies:** AC-16

---

## Data Factories Created

### DungeonPetStats Factory

Inline test helpers in test file:
- `makeHighStatPet()` — all stats at 80
- `makeLowEnergyPet()` — energy=5, others at 50
- `makeDefaultPet()` — all stats at 60

### DungeonConfig Factory

- `makeDefaultConfig()` — uses DEFAULT_MONSTER_TABLE, DEFAULT_LOOT_TABLE, digger, 40×30, maxRooms=8

---

## Mock Requirements

None — `DungeonGameEngine` is a pure, headless, self-contained class. No HTTP, no Nostr, no filesystem I/O. rot.js is used synchronously.

---

## Required data-testid Attributes

Not applicable — engine only, no UI.

---

## Implementation Checklist

### Step 1: Install rot-js

- [ ] `pnpm --filter @toon-protocol/pet-dvm add rot-js`
- [ ] Verify `rot-js` in package.json dependencies
- [ ] Run: `pnpm --filter @toon-protocol/pet-dvm build` (timeout: 60000)

### Step 2: Create types.ts

- [ ] Create `packages/pet-dvm/src/dungeon/types.ts`
- [ ] Define `DungeonEngineErrorCode` union type
- [ ] Define `DungeonEngineError extends Error`
- [ ] Define `MonsterEntry` interface
- [ ] Define `LootEntry` interface
- [ ] Define `DungeonStatDelta` interface
- [ ] Define `DungeonConfig` interface
- [ ] Define `DungeonPetStats` interface
- [ ] Define `EncounterRecord` interface
- [ ] Define `LootRecord` interface
- [ ] Define `DungeonRunResult` interface

### Step 3: Create DungeonGameEngine.ts

- [ ] Create `packages/pet-dvm/src/dungeon/DungeonGameEngine.ts`
- [ ] Implement `hashSeed(seed: string): number`
- [ ] Implement `DEFAULT_MONSTER_TABLE` constant
- [ ] Implement `DEFAULT_LOOT_TABLE` constant
- [ ] Implement `DungeonGameEngine` class with constructor validation
- [ ] Implement `run(seed, petStats)` method
- [ ] Implement rot.js RNG seeding at run start
- [ ] Implement dungeon generation (Digger/Cellular/Rogue dispatch)
- [ ] Implement room traversal with energy-based depth limit
- [ ] Implement monster spawning per room
- [ ] Implement `resolveCombat()` internal function
- [ ] Implement loot roll and weighted selection
- [ ] Implement stat delta accumulation
- [ ] Implement narrative summary generation

### Step 4: Write tests

- [ ] Create `packages/pet-dvm/src/dungeon/DungeonGameEngine.test.ts`
- [ ] 4× determinism tests (100 iterations)
- [ ] 6+ dungeon generation tests
- [ ] 8+ encounter resolution tests
- [ ] 4+ loot and narrative tests
- [ ] 3+ property/fuzz tests
- [ ] 1 benchmark test

### Step 5: Update index.ts exports

- [ ] Add dungeon exports to `packages/pet-dvm/src/index.ts`

### Step 6: Verify

- [ ] `pnpm --filter @toon-protocol/pet-dvm build` — zero TS errors
- [ ] `pnpm --filter @toon-protocol/pet-dvm test` — all pass

---

## Running Tests

```bash
# Run all tests for pet-dvm
pnpm --filter @toon-protocol/pet-dvm test

# Run only dungeon tests
pnpm --filter @toon-protocol/pet-dvm test -- --testPathPattern=dungeon

# Run with verbose output
pnpm --filter @toon-protocol/pet-dvm test -- --verbose
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete) — tests written, all fail until implementation

### GREEN Phase — implement DungeonGameEngine to make tests pass one by one

### REFACTOR Phase — review for code quality after all tests green

---

## Notes

- rot.js uses a **global** singleton RNG. Always call `RNG.setSeed()` at the very start of `run()` to ensure determinism.
- `noUncheckedIndexedAccess: true` — all array accesses need undefined guards.
- Tests use Jest (not Vitest) with ts-jest.
- Do NOT import `ROT.Display` or `ROT.FOV` — only Map generators and RNG are headless-safe.
- Fuzz test seeds: `Array.from({length:50}, (_, i) => \`seed-${i}\`)` pattern.

---

**Generated by BMad TEA Agent** - 2026-04-09
