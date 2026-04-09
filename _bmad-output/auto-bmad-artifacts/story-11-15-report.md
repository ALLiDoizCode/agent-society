# Story 11-15 Report: Dungeon Engine Core

**Date:** 2026-04-09
**Status:** DONE
**Agent:** claude-sonnet-4-6
**Branch:** epic-11

---

## Summary

Story 11-15 delivers a headless, deterministic `DungeonGameEngine` class in `@toon-protocol/pet-dvm` that uses rot.js to procedurally generate dungeons and simulate turn-based dungeon runs. All 20 acceptance criteria satisfied. P0 quality gate G17 (determinism) verified with 4 seeds × 100 iterations each.

---

## What Was Built

### New Package: `packages/pet-dvm/src/dungeon/`

**`types.ts`** — Complete type definitions:
- `DungeonConfig` (width, height, maxRooms, dungeonType, monsterTable, lootTable)
- `DungeonPetStats` (hunger, happiness, health, hygiene, energy)
- `DungeonRunResult` (seed, dungeonType, roomsGenerated, roomsVisited, floorsReached, encounters, lootFound, statDeltas, narrativeSummary, durationMs)
- `DungeonStatDelta`, `EncounterRecord`, `LootRecord`, `MonsterEntry`, `LootEntry`
- `DungeonEngineError extends Error` with `DungeonEngineErrorCode` (INVALID_CONFIG, INVALID_SEED, EMPTY_MONSTER_TABLE, EMPTY_LOOT_TABLE)

**`DungeonGameEngine.ts`** — Engine implementation:
- `hashSeed(seed: string): number` — deterministic djb2-style string → numeric seed
- `DEFAULT_MONSTER_TABLE` (5 monsters: Slime → Mini Dragon) and `DEFAULT_LOOT_TABLE` (5 items)
- `DungeonGameEngine` class with constructor validation and `run(seed, petStats): DungeonRunResult`
- rot.js Digger, Cellular, Rogue map generation with global RNG.setSeed() at run start
- Internal `resolveCombat()` — round-based combat with pet power formula
- Internal `pickWeightedLoot()` — rarity-weighted selection
- `deriveCellularRooms()` — pseudo-room extraction from Cellular maps (no getRooms() available)
- Energy-driven depth: `Math.floor(energy / 20)` clamped to `[1, maxRooms]`
- Stat delta accumulation with end-of-run energy/hunger costs
- Narrative summary generation

**`DungeonGameEngine.test.ts`** — 29 new tests:
- 4 × determinism tests (100 iterations each, 4 different seeds)
- 6 dungeon generation tests (Digger, Cellular, Rogue, echo-back, bounds, invalid type)
- 8 encounter resolution tests (high stats, low energy, valid monster IDs, damage/happiness deltas, error codes)
- 4 loot and narrative tests (valid item IDs, non-empty summary, roomsVisited in summary, positive durationMs)
- 3 property/fuzz tests (50 seeds: roomsGenerated >= 1, floorsReached bounds, statDeltas finite)
- 1 benchmark test (warn-only < 50ms gate)
- 3 hashSeed utility tests

### Modified Files
- `packages/pet-dvm/src/index.ts` — 17 new dungeon exports (class, constants, all types)
- `packages/pet-dvm/package.json` — `rot-js` added to dependencies

---

## Test Results

```
Test Suites: 12 passed, 12 total
Tests:       244 passed, 244 total
Time:        ~4s
```

Zero TypeScript errors. Zero test failures.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| RNG reset strategy | `RNG.setSeed()` at top of every `run()` | rot.js global singleton — only safe determinism approach |
| Cellular rooms | Sample passable cells as pseudo-rooms | Cellular has no `getRooms()` method |
| Rogue rooms | `as unknown` cast for private `rooms` field | Rogue extends Map, not Dungeon; no `getRooms()` in type signature |
| Rogue constructor | `new ROTMap.Rogue(width, height, {})` | Requires 3 args per type definition |
| Combat cap | 200 rounds max | Prevents theoretical infinite loop on zero-power edge inputs |
| floorsReached | `Math.max(1, roomsVisited)` | Always at least 1 even if pet fled first room immediately |

---

## AC Verification

All 20 ACs satisfied. See traceability matrix at `_bmad-output/test-artifacts/traceability/story-11-15-trace.md`.

---

## Downstream Impact

- **Story 11-16 (Pet-Dungeon Stat Bridge):** Imports `DungeonGameEngine`, `DungeonRunResult`, `DungeonConfig` — all exported from index.ts.
- **Story 11-17 (Dungeon DVM Handler):** Wraps `DungeonGameEngine` in kind:5250 DVM handler — engine is ready.
- No breaking changes to existing pet-dvm exports.
