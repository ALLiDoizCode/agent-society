/**
 * Dungeon Adventure Log
 *
 * Serialises a DungeonRunResult into a structured narrative log entry and
 * provides an upload function that persists the entry to Arweave via the
 * existing ArweaveUploadAdapter interface.
 *
 * Decision D11-PM-005: Adventure logs on Arweave via kind:5094.
 *
 * @module dungeon/adventureLog
 */

import type { DungeonRunResult, DungeonStatDelta } from './types';
import type { ArweaveUploadAdapter } from '../checkpoint/types';

// ============================================================
// Types
// ============================================================

/** A permanent adventure biography entry for a Blobbi pet run */
export interface AdventureLogEntry {
  /** pet identifier */
  blobbiId: string;
  /** dungeon identifier (e.g. 'kobold-caves') */
  dungeonId: string;
  /** the seed used for this run (echoed from DungeonRunResult.seed) */
  dungeonSeed: string;
  /** ISO-8601 timestamp (e.g. new Date().toISOString()) */
  timestamp: string;
  /** human-readable narrative of the run */
  narrative: string;
  /** structured run statistics */
  stats: {
    roomsVisited: number;
    floorsReached: number;
    encountersWon: number;
    encountersFled: number;
    lootCount: number;
  };
  /** the stat deltas from the run */
  statDeltas: DungeonStatDelta;
  /** loot found during the run */
  loot: { itemId: string; itemName: string; rarity: number }[];
}

/** Configuration for uploadAdventureLog */
export interface DungeonAdventureLogConfig {
  /** Arweave upload adapter (reuse ArweaveUploadAdapter from checkpoint/types.ts) */
  arweaveAdapter: ArweaveUploadAdapter;
  /** Additional Arweave data item tags (lower priority than mandatory tags) */
  arweaveTags?: Record<string, string>;
}

// ============================================================
// Narrative builder (internal)
// ============================================================

function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Internal narrative builder — called only by generateAdventureLog.
 * Accepts pre-computed won/fled counts to avoid redundant filtering.
 * Not exported; tested indirectly via generateAdventureLog.
 */
function buildNarrative(
  dungeonId: string,
  result: DungeonRunResult,
  won: number,
  fled: number
): string {
  const intro = `Blobbi entered ${dungeonId} and explored ${result.roomsVisited} room(s).`;
  const encounters = `Won ${won} encounter(s), fled from ${fled}.`;

  const lootLine =
    result.lootFound.length > 0
      ? `Found: ${result.lootFound.map((l) => l.itemName).join(', ')}.`
      : 'No loot found.';

  const statLine = `Stats changed: hunger ${formatDelta(result.statDeltas.hunger)}, energy ${formatDelta(result.statDeltas.energy)}, happiness ${formatDelta(result.statDeltas.happiness)}.`;

  return [intro, encounters, lootLine, statLine].join(' ');
}

// ============================================================
// Public API
// ============================================================

/**
 * Pure function — generates an AdventureLogEntry from a DungeonRunResult.
 * No side effects, no async.
 */
export function generateAdventureLog(
  blobbiId: string,
  dungeonId: string,
  result: DungeonRunResult
): AdventureLogEntry {
  // Compute won/fled once and reuse in both the narrative and stats object
  const encountersWon = result.encounters.filter((e) => e.petWon).length;
  const encountersFled = result.encounters.filter((e) => !e.petWon).length;

  return {
    blobbiId,
    dungeonId,
    dungeonSeed: result.seed,
    timestamp: new Date().toISOString(),
    narrative: buildNarrative(dungeonId, result, encountersWon, encountersFled),
    stats: {
      roomsVisited: result.roomsVisited,
      floorsReached: result.floorsReached,
      encountersWon,
      encountersFled,
      lootCount: result.lootFound.length,
    },
    // Explicit property pick — defensive copy that retains only the five declared fields,
    // preventing unexpected extra properties from leaking into the Arweave payload.
    statDeltas: {
      hunger: result.statDeltas.hunger,
      happiness: result.statDeltas.happiness,
      health: result.statDeltas.health,
      hygiene: result.statDeltas.hygiene,
      energy: result.statDeltas.energy,
    },
    loot: result.lootFound.map((l) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      rarity: l.rarity,
    })),
  };
}

/**
 * Uploads an AdventureLogEntry to Arweave via the configured adapter.
 * Mandatory tags always override caller-supplied arweaveTags (same pattern as CheckpointManager).
 * Does NOT swallow errors — upload failures propagate to the caller.
 */
export async function uploadAdventureLog(
  config: DungeonAdventureLogConfig,
  entry: AdventureLogEntry
): Promise<{ txId: string }> {
  const buffer = Buffer.from(JSON.stringify(entry));

  const mandatoryTags: Record<string, string> = {
    'Content-Type': 'application/json',
    'App-Name': 'toon-pet-adventure-log',
    'Blobbi-Id': entry.blobbiId,
    'Dungeon-Id': entry.dungeonId,
    'Dungeon-Seed': entry.dungeonSeed,
    Timestamp: entry.timestamp,
  };
  const mergedTags = { ...(config.arweaveTags ?? {}), ...mandatoryTags };

  return config.arweaveAdapter.upload(buffer, mergedTags);
}
