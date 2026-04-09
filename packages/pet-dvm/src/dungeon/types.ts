/**
 * Dungeon Game Engine Type Definitions
 *
 * Type-only file — no implementation logic. These types define the contracts
 * for the DungeonGameEngine class and its methods.
 *
 * @module dungeon/types
 */

// ============================================================
// Error Type
// ============================================================

/** Error codes for dungeon engine failures */
export type DungeonEngineErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_SEED'
  | 'EMPTY_MONSTER_TABLE'
  | 'EMPTY_LOOT_TABLE';

/** Typed error thrown by the dungeon engine */
export class DungeonEngineError extends Error {
  constructor(
    message: string,
    public readonly code: DungeonEngineErrorCode
  ) {
    super(message);
    this.name = 'DungeonEngineError';
    // Fix prototype chain for instanceof checks when extending built-in Error
    Object.setPrototypeOf(this, DungeonEngineError.prototype);
  }
}

// ============================================================
// Monster & Loot Tables
// ============================================================

/** A single entry in the monster table */
export interface MonsterEntry {
  id: string;
  name: string;
  minFloor: number;
  basePower: number;
  baseHp: number;
}

/** Net stat change carried by a loot item */
export interface DungeonStatDelta {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
}

/** A single entry in the loot table */
export interface LootEntry {
  id: string;
  name: string;
  /** Rarity weight in [0, 1]; higher = more common */
  rarity: number;
  statDelta: Partial<DungeonStatDelta>;
}

// ============================================================
// Config
// ============================================================

/** Configuration for a DungeonGameEngine instance */
export interface DungeonConfig {
  /** Dungeon grid width (default: 40) */
  width: number;
  /** Dungeon grid height (default: 30) */
  height: number;
  /** Max rooms to generate (default: 8) */
  maxRooms: number;
  /** rot.js generator type */
  dungeonType: 'digger' | 'cellular' | 'rogue';
  /** Monster spawn table */
  monsterTable: MonsterEntry[];
  /** Loot drop table */
  lootTable: LootEntry[];
}

// ============================================================
// Pet Stats (dungeon-local view)
// ============================================================

/** Pet stats as seen by the dungeon engine (all 1–100) */
export interface DungeonPetStats {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
}

// ============================================================
// Run Result Types
// ============================================================

/** Record of a single monster encounter during the run */
export interface EncounterRecord {
  monsterId: string;
  monsterName: string;
  petWon: boolean;
  damageDealt: number;
  damageTaken: number;
}

/** Record of a loot item found during the run */
export interface LootRecord {
  itemId: string;
  itemName: string;
  rarity: number;
}

/** Full result returned by DungeonGameEngine.run() */
export interface DungeonRunResult {
  /** The seed used (echoed back) */
  seed: string;
  /** Which generator was used */
  dungeonType: string;
  /** Total rooms in the dungeon */
  roomsGenerated: number;
  /** Rooms the pet traversed */
  roomsVisited: number;
  /** Depth reached (1-indexed) */
  floorsReached: number;
  /** Monster encounters during the run */
  encounters: EncounterRecord[];
  /** Loot items found during the run */
  lootFound: LootRecord[];
  /** Net stat changes from the run */
  statDeltas: DungeonStatDelta;
  /** Human-readable summary */
  narrativeSummary: string;
  /** How long the simulation took in milliseconds */
  durationMs: number;
}
