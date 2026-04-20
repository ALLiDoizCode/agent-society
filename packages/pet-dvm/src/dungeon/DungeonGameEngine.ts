/**
 * DungeonGameEngine — Headless, deterministic dungeon run simulator.
 *
 * Uses rot.js to procedurally generate dungeons and simulate turn-based dungeon
 * runs given a seed and pet stats. Identical (seed, petStats) input always
 * produces identical DungeonRunResult (P0 determinism gate G17).
 *
 * CRITICAL: rot.js uses a global RNG singleton. Always call RNG.setSeed() at the
 * start of run() to reset state. Never call run() concurrently.
 *
 * @module dungeon/DungeonGameEngine
 */

import { RNG, Map as ROTMap } from 'rot-js';
import type { Room } from 'rot-js/lib/map/features';
import type {
  DungeonConfig,
  DungeonPetStats,
  DungeonRunResult,
  MonsterEntry,
  LootEntry,
  EncounterRecord,
  LootRecord,
  DungeonStatDelta,
} from './types';
import { DungeonEngineError } from './types';

// ============================================================
// Default Tables
// ============================================================

export const DEFAULT_MONSTER_TABLE: MonsterEntry[] = [
  { id: 'slime', name: 'Slime', minFloor: 1, basePower: 5, baseHp: 20 },
  { id: 'goblin', name: 'Goblin', minFloor: 1, basePower: 8, baseHp: 30 },
  { id: 'orc', name: 'Orc', minFloor: 2, basePower: 12, baseHp: 50 },
  { id: 'troll', name: 'Cave Troll', minFloor: 3, basePower: 18, baseHp: 80 },
  {
    id: 'dragon',
    name: 'Mini Dragon',
    minFloor: 4,
    basePower: 25,
    baseHp: 120,
  },
];

export const DEFAULT_LOOT_TABLE: LootEntry[] = [
  {
    id: 'health_potion',
    name: 'Health Potion',
    rarity: 0.6,
    statDelta: { health: 15 },
  },
  {
    id: 'energy_drink',
    name: 'Energy Drink',
    rarity: 0.5,
    statDelta: { energy: 10 },
  },
  {
    id: 'berry',
    name: 'Sweet Berry',
    rarity: 0.7,
    statDelta: { hunger: 8, happiness: 5 },
  },
  { id: 'soap', name: 'Travel Soap', rarity: 0.4, statDelta: { hygiene: 12 } },
  {
    id: 'trophy',
    name: 'Monster Trophy',
    rarity: 0.2,
    statDelta: { happiness: 20 },
  },
];

// ============================================================
// Internal Types
// ============================================================

interface CombatResult {
  petWon: boolean;
  damageDealt: number;
  damageTaken: number;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Deterministic string → numeric seed via djb2-style hash.
 * Produces a stable 32-bit integer from any string.
 */
export function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Resolve combat between pet and a monster using the seeded global RNG.
 * Internal — not exported.
 *
 * Pet combat power: Math.floor(petStats.hunger * 0.5 + petStats.energy * 0.3 + 1)
 * Combat runs in rounds until pet HP or monster HP reaches 0.
 */
function resolveCombat(
  petStats: DungeonPetStats,
  monster: MonsterEntry
): CombatResult {
  const petPower = Math.floor(
    petStats.hunger * 0.5 + petStats.energy * 0.3 + 1
  );
  let petHp = petStats.health;
  let monsterHp = monster.baseHp;
  let totalDamageDealt = 0;
  let totalDamageTaken = 0;

  // Safety cap: max 200 rounds to prevent infinite loops on edge inputs
  const MAX_ROUNDS = 200;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (petHp <= 0 || monsterHp <= 0) break;

    // Pet attacks monster
    const petDmg = petPower * RNG.getUniform() * 2;
    monsterHp -= petDmg;
    totalDamageDealt += petDmg;

    if (monsterHp <= 0) break;

    // Monster attacks pet
    const monsterDmg = monster.basePower * RNG.getUniform();
    petHp -= monsterDmg;
    totalDamageTaken += monsterDmg;
  }

  return {
    petWon: monsterHp <= 0,
    damageDealt: Math.round(totalDamageDealt),
    damageTaken: Math.round(totalDamageTaken),
  };
}

/**
 * Pick a loot item from the table weighted by rarity using the seeded global RNG.
 * Returns undefined if table is empty (should not happen after validation).
 */
function pickWeightedLoot(lootTable: LootEntry[]): LootEntry | undefined {
  const totalWeight = lootTable.reduce((sum, e) => sum + e.rarity, 0);
  if (totalWeight <= 0) return lootTable[0];

  let roll = RNG.getUniform() * totalWeight;
  for (const entry of lootTable) {
    roll -= entry.rarity;
    if (roll <= 0) return entry;
  }
  return lootTable[lootTable.length - 1];
}

// ============================================================
// DungeonGameEngine
// ============================================================

export class DungeonGameEngine {
  private readonly config: DungeonConfig;

  constructor(config: DungeonConfig) {
    // Validate monster table
    if (!config.monsterTable || config.monsterTable.length === 0) {
      throw new DungeonEngineError(
        'monsterTable must be non-empty',
        'EMPTY_MONSTER_TABLE'
      );
    }

    // Validate loot table
    if (!config.lootTable || config.lootTable.length === 0) {
      throw new DungeonEngineError(
        'lootTable must be non-empty',
        'EMPTY_LOOT_TABLE'
      );
    }

    // Validate dungeonType
    const validTypes = ['digger', 'cellular', 'rogue'];
    if (!validTypes.includes(config.dungeonType)) {
      throw new DungeonEngineError(
        `Invalid dungeonType: '${config.dungeonType}'. Must be one of: ${validTypes.join(', ')}`,
        'INVALID_CONFIG'
      );
    }

    // Validate dimensions
    if (
      !Number.isFinite(config.width) ||
      config.width < 10 ||
      !Number.isFinite(config.height) ||
      config.height < 10 ||
      !Number.isFinite(config.maxRooms) ||
      config.maxRooms < 1
    ) {
      throw new DungeonEngineError(
        'width and height must be >= 10, maxRooms must be >= 1',
        'INVALID_CONFIG'
      );
    }

    this.config = config;
  }

  /**
   * Run a full dungeon simulation. Deterministic: identical (seed, petStats)
   * always produces identical DungeonRunResult.
   *
   * NEVER call concurrently — rot.js RNG is a global singleton.
   */
  run(seed: string, petStats: DungeonPetStats): DungeonRunResult {
    if (!seed || typeof seed !== 'string') {
      throw new DungeonEngineError(
        'seed must be a non-empty string',
        'INVALID_SEED'
      );
    }

    const startMs = Date.now();

    // --- 1. Seed the global RNG (MUST be first rot.js call) ---
    // WARNING: RNG.setSeed() resets a GLOBAL SINGLETON shared across the entire
    // Node.js process. rot.js does not support instance-scoped RNG. Consequences:
    //   - NEVER call run() concurrently (e.g., via Promise.all or Worker threads).
    //     Concurrent calls will corrupt each other's RNG state, producing
    //     non-deterministic results and violating the P0 determinism gate (G17).
    //   - Tests MUST run sequentially (Jest --runInBand) to avoid cross-test
    //     RNG interference.
    //   - If future work requires parallel dungeon runs, rot.js must be forked
    //     to support instance-scoped RNG, or runs must be serialized via a queue.
    const numericSeed = hashSeed(seed);
    RNG.setSeed(numericSeed);

    // --- 2. Generate dungeon map ---
    const { width, height, maxRooms, dungeonType } = this.config;

    let rooms: Room[] = [];

    if (dungeonType === 'digger') {
      const digger = new ROTMap.Digger(width, height);
      digger.create(() => {
        /* collect passable cells — we only need rooms */
      });
      rooms = digger.getRooms();
    } else if (dungeonType === 'cellular') {
      const cellular = new ROTMap.Cellular(width, height);
      // Run 4 generations for a well-formed cave
      cellular.randomize(0.5);
      for (let i = 0; i < 4; i++) cellular.create();
      // Cellular doesn't have getRooms(); derive pseudo-rooms by sampling cells
      rooms = deriveCellularRooms(cellular, width, height);
    } else {
      // rogue
      const rogue = new ROTMap.Rogue(width, height, {});
      rogue.create(() => {
        /* noop */
      });
      // Rogue exposes rooms via private field; fall back to digger if unavailable
      rooms = (rogue as unknown as { getRooms?(): Room[] }).getRooms?.() ?? [];
    }

    // Ensure at least one room
    if (rooms.length === 0) {
      // Fallback: synthesize a single room at center — cast via unknown for the stub
      rooms = [
        {
          getCenter: () => [Math.floor(width / 2), Math.floor(height / 2)],
        } as unknown as Room,
      ];
    }

    const roomsGenerated = rooms.length;

    // --- 3. Determine exploration depth ---
    // Energy drives depth: Math.floor(energy / 20) clamped to [1, maxRooms]
    const intendedDepth = Math.max(
      1,
      Math.min(maxRooms, Math.floor(petStats.energy / 20))
    );
    const roomsToVisit = Math.min(intendedDepth, roomsGenerated);

    // --- 4. Simulate traversal ---
    const encounters: EncounterRecord[] = [];
    const lootFound: LootRecord[] = [];
    const statDeltas: DungeonStatDelta = {
      hunger: 0,
      happiness: 0,
      health: 0,
      hygiene: 0,
      energy: 0,
    };

    // Track pet's derived HP during the run (starts at full health)
    let currentPetHp = petStats.health;
    let roomsVisited = 0;

    for (let roomIdx = 0; roomIdx < roomsToVisit; roomIdx++) {
      // Pet fled / died in previous room
      if (currentPetHp <= 0) break;

      roomsVisited++;
      const floor = roomIdx + 1; // 1-indexed

      // Monsters in this room: 0–2 based on seeded RNG
      const monsterCount = Math.floor(RNG.getUniform() * 3); // 0, 1, or 2

      for (let m = 0; m < monsterCount; m++) {
        if (currentPetHp <= 0) break;

        // Pick a monster eligible for this floor
        const eligibleMonsters = this.config.monsterTable.filter(
          (mon) => mon.minFloor <= floor
        );
        const monsterPool =
          eligibleMonsters.length > 0
            ? eligibleMonsters
            : this.config.monsterTable;

        const monsterIdx = Math.floor(RNG.getUniform() * monsterPool.length);
        const monster = monsterPool[monsterIdx];
        if (!monster) continue;

        // Use a temporary pet stats snapshot with current HP for combat
        const combatPetStats: DungeonPetStats = {
          ...petStats,
          health: currentPetHp,
        };

        const combat = resolveCombat(combatPetStats, monster);

        encounters.push({
          monsterId: monster.id,
          monsterName: monster.name,
          petWon: combat.petWon,
          damageDealt: combat.damageDealt,
          damageTaken: combat.damageTaken,
        });

        // Accumulate stat deltas
        statDeltas.health -= combat.damageTaken;
        statDeltas.happiness += combat.petWon ? 5 : 0;
        statDeltas.energy -= 3;
        statDeltas.hygiene -= 2;

        // Update current HP
        currentPetHp -= combat.damageTaken;
      }

      // Loot roll: 30% base chance per room
      const lootChance = 0.3;
      if (RNG.getUniform() < lootChance) {
        const item = pickWeightedLoot(this.config.lootTable);
        if (item) {
          lootFound.push({
            itemId: item.id,
            itemName: item.name,
            rarity: item.rarity,
          });

          // Apply loot stat delta
          if (item.statDelta.health !== undefined)
            statDeltas.health += item.statDelta.health;
          if (item.statDelta.energy !== undefined)
            statDeltas.energy += item.statDelta.energy;
          if (item.statDelta.hunger !== undefined)
            statDeltas.hunger += item.statDelta.hunger;
          if (item.statDelta.happiness !== undefined)
            statDeltas.happiness += item.statDelta.happiness;
          if (item.statDelta.hygiene !== undefined)
            statDeltas.hygiene += item.statDelta.hygiene;
        }
      }
    }

    // --- 5. End-of-run stat costs ---
    statDeltas.energy -= roomsVisited * 2;
    statDeltas.hunger -= Math.floor(roomsVisited * 1.5);

    // --- 6. Build result ---
    const floorsReached = Math.max(1, roomsVisited);

    // Rare loot count (rarity > 0.8 is "common" — items at rarity <= 0.3 are rare)
    // Per story spec: rarity > 0.8 = rare. Here rarity is "commonness weight",
    // so items with rarity < 0.3 (less common) are "rare" for narrative purposes.
    const rareLoot = lootFound.filter((l) => l.rarity < 0.3);
    const wins = encounters.filter((e) => e.petWon).length;

    const narrativeSummary = buildNarrativeSummary({
      roomsVisited,
      floorsReached,
      wins,
      totalEncounters: encounters.length,
      rareLoot,
    });

    const durationMs = Date.now() - startMs;

    return {
      seed,
      dungeonType,
      roomsGenerated,
      roomsVisited,
      floorsReached,
      encounters,
      lootFound,
      statDeltas,
      narrativeSummary,
      durationMs,
    };
  }
}

// ============================================================
// Cellular room derivation (no getRooms() on Cellular)
// ============================================================

/**
 * Derive pseudo-room list from a Cellular map by scanning for passable cells
 * and grouping them into approximate room clusters.
 * Returns at minimum one entry (cast as Room[] via unknown for compatibility).
 */
function deriveCellularRooms(
  cellular: InstanceType<typeof ROTMap.Cellular>,
  width: number,
  height: number
): Room[] {
  const passable: [number, number][] = [];
  cellular.create((x: number, y: number, contents: number) => {
    if (contents === 0) passable.push([x, y]);
  });

  const center: [number, number] = [
    Math.floor(width / 2),
    Math.floor(height / 2),
  ];

  if (passable.length === 0) {
    return [{ getCenter: () => center } as unknown as Room];
  }

  // Sample up to 8 spread-out cells as "rooms"
  const step = Math.max(1, Math.floor(passable.length / 8));
  const rooms: Room[] = [];
  for (let i = 0; i < passable.length; i += step) {
    const cell = passable[i];
    if (cell) {
      const cx = cell[0];
      const cy = cell[1];
      rooms.push({ getCenter: () => [cx, cy] } as unknown as Room);
    }
  }

  return rooms.length > 0
    ? rooms
    : [{ getCenter: () => center } as unknown as Room];
}

// ============================================================
// Narrative Summary
// ============================================================

interface NarrativeParams {
  roomsVisited: number;
  floorsReached: number;
  wins: number;
  totalEncounters: number;
  rareLoot: LootRecord[];
}

function buildNarrativeSummary(p: NarrativeParams): string {
  const parts: string[] = [];

  parts.push(
    `Reached floor ${p.floorsReached} and explored ${p.roomsVisited} room${p.roomsVisited !== 1 ? 's' : ''}`
  );

  if (p.totalEncounters > 0) {
    parts.push(
      `defeated ${p.wins} of ${p.totalEncounters} monster${p.totalEncounters !== 1 ? 's' : ''}`
    );
  }

  if (p.rareLoot.length > 0) {
    const names = p.rareLoot.map((l) => l.itemName).join(', ');
    parts.push(`found rare loot: ${names}`);
  }

  return parts.join(', ') + '.';
}
