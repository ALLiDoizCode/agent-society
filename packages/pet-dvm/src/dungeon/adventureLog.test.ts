/**
 * Adventure Log unit and integration tests
 *
 * Story 11-18: Dungeon Adventure Log
 *
 * AC-6  — 3 narrative unit tests
 * AC-7  — 2 log-format unit tests
 * AC-8  — 1 Arweave upload integration test
 * AC-9  — 1 biography query integration test
 *
 * Total: 7 tests (baseline 292 → 299)
 */

import { generateAdventureLog, uploadAdventureLog } from './adventureLog';
import type { DungeonRunResult } from './types';
import type { ArweaveUploadAdapter } from '../checkpoint/types';

// ---------------------------------------------------------------------------
// Test helpers / mock factory
// ---------------------------------------------------------------------------

function makeMockAdapter(txId = 'mock-tx-id'): ArweaveUploadAdapter {
  return {
    upload: jest.fn().mockResolvedValue({ txId }),
  };
}

// Minimal valid DungeonRunResult used across multiple tests
const baseResult: DungeonRunResult = {
  seed: 'test-seed-42',
  dungeonType: 'digger',
  roomsGenerated: 10,
  roomsVisited: 5,
  floorsReached: 2,
  encounters: [
    {
      monsterId: 'kobold',
      monsterName: 'Kobold',
      petWon: true,
      damageDealt: 10,
      damageTaken: 2,
    },
    {
      monsterId: 'goblin',
      monsterName: 'Goblin',
      petWon: true,
      damageDealt: 8,
      damageTaken: 3,
    },
    {
      monsterId: 'rat',
      monsterName: 'Giant Rat',
      petWon: false,
      damageDealt: 0,
      damageTaken: 5,
    },
  ],
  lootFound: [
    { itemId: 'sword', itemName: 'Iron Sword', rarity: 0.5 },
    { itemId: 'potion', itemName: 'Health Potion', rarity: 0.3 },
  ],
  statDeltas: {
    hunger: -10,
    happiness: 5,
    health: -3,
    hygiene: 0,
    energy: -20,
  },
  narrativeSummary: 'A test run through the dungeon.',
  durationMs: 42,
};

// ---------------------------------------------------------------------------
// AC-6: Narrative generator unit tests (3 tests)
// ---------------------------------------------------------------------------

describe('generateAdventureLog — narrative generator (AC-6)', () => {
  it('[P0] includes all four narrative clauses in correct order for 2 won / 1 fled / 2 loot run', () => {
    const entry = generateAdventureLog(
      'blobbi-001',
      'kobold-caves',
      baseResult
    );

    // Clause 1: intro
    expect(entry.narrative).toContain(
      'Blobbi entered kobold-caves and explored 5 room(s).'
    );
    // Clause 2: encounter summary
    expect(entry.narrative).toContain('Won 2 encounter(s), fled from 1.');
    // Clause 3: loot summary
    expect(entry.narrative).toContain('Found: Iron Sword, Health Potion.');
    // Clause 4: stat delta summary
    expect(entry.narrative).toContain(
      'Stats changed: hunger -10, energy -20, happiness +5.'
    );

    // Order: intro before encounters before loot before stats
    const introIdx = entry.narrative.indexOf('Blobbi entered');
    const encIdx = entry.narrative.indexOf('Won 2');
    const lootIdx = entry.narrative.indexOf('Found:');
    const statIdx = entry.narrative.indexOf('Stats changed:');
    expect(introIdx).toBeLessThan(encIdx);
    expect(encIdx).toBeLessThan(lootIdx);
    expect(lootIdx).toBeLessThan(statIdx);
  });

  it('[P0] uses "No loot found." when lootFound is empty, preserving clause order', () => {
    const noLootResult: DungeonRunResult = {
      ...baseResult,
      lootFound: [],
    };
    const entry = generateAdventureLog(
      'blobbi-002',
      'shadow-cavern',
      noLootResult
    );

    expect(entry.narrative).toContain('No loot found.');
    expect(entry.narrative).not.toContain('Found:');

    // AC-3: all four clauses must appear in exact order even in the no-loot case
    const introIdx = entry.narrative.indexOf('Blobbi entered');
    const encIdx = entry.narrative.indexOf('Won');
    const lootIdx = entry.narrative.indexOf('No loot found.');
    const statIdx = entry.narrative.indexOf('Stats changed:');
    expect(introIdx).toBeLessThan(encIdx);
    expect(encIdx).toBeLessThan(lootIdx);
    expect(lootIdx).toBeLessThan(statIdx);
  });

  it('[P0] formats stat deltas as +N / -N / 0 correctly', () => {
    // hunger: -10 (negative), energy: 0 (zero), happiness: +5 (positive)
    const mixedDeltaResult: DungeonRunResult = {
      ...baseResult,
      statDeltas: {
        hunger: -10,
        energy: 0,
        happiness: 5,
        health: 0,
        hygiene: 0,
      },
    };
    const entry = generateAdventureLog(
      'blobbi-003',
      'kobold-caves',
      mixedDeltaResult
    );

    // hunger negative: "-10" (already negative)
    expect(entry.narrative).toContain('hunger -10');
    // energy zero: bare "0" (no sign prefix)
    expect(entry.narrative).toContain('energy 0');
    // happiness positive: "+5"
    expect(entry.narrative).toContain('happiness +5');
  });
});

// ---------------------------------------------------------------------------
// AC-7: Log format unit tests (2 tests)
// ---------------------------------------------------------------------------

describe('generateAdventureLog — log format (AC-7)', () => {
  it('[P0] returns a valid JSON-serialisable AdventureLogEntry with all required fields', () => {
    const entry = generateAdventureLog(
      'blobbi-001',
      'kobold-caves',
      baseResult
    );

    // Serialisable (no undefined, no circular refs)
    expect(() => JSON.stringify(entry)).not.toThrow();

    // All required top-level fields present
    expect(entry).toHaveProperty('blobbiId', 'blobbi-001');
    expect(entry).toHaveProperty('dungeonId', 'kobold-caves');
    expect(entry).toHaveProperty('dungeonSeed', baseResult.seed);
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('narrative');
    expect(entry).toHaveProperty('stats');
    expect(entry).toHaveProperty('statDeltas');
    expect(entry).toHaveProperty('loot');

    // statDeltas preserves ALL five fields including health and hygiene (AC-1)
    expect(entry.statDeltas).toEqual(baseResult.statDeltas);
    expect(typeof entry.statDeltas.health).toBe('number');
    expect(typeof entry.statDeltas.hygiene).toBe('number');

    // loot array item shape: must contain exactly { itemId, itemName, rarity } per AC-1
    expect(entry.loot).toHaveLength(baseResult.lootFound.length);
    expect(entry.loot[0]).toEqual({ itemId: 'sword', itemName: 'Iron Sword', rarity: 0.5 });
    expect(entry.loot[1]).toEqual({ itemId: 'potion', itemName: 'Health Potion', rarity: 0.3 });

    // Derived stats from result
    expect(entry.dungeonSeed).toBe(baseResult.seed);
    expect(entry.stats.roomsVisited).toBe(baseResult.roomsVisited);
    expect(entry.stats.floorsReached).toBe(baseResult.floorsReached);
    expect(entry.stats.lootCount).toBe(baseResult.lootFound.length);

    // timestamp is a valid ISO-8601 string (new Date('garbage') does NOT throw —
    // it returns Invalid Date — so we must also check getTime() is not NaN)
    expect(typeof entry.timestamp).toBe('string');
    expect(isNaN(new Date(entry.timestamp).getTime())).toBe(false);
  });

  it('[P0] stats.encountersWon + stats.encountersFled === result.encounters.length', () => {
    const entry = generateAdventureLog(
      'blobbi-001',
      'kobold-caves',
      baseResult
    );

    expect(entry.stats.encountersWon + entry.stats.encountersFled).toBe(
      baseResult.encounters.length
    );
    expect(entry.stats.encountersWon).toBe(
      baseResult.encounters.filter((e) => e.petWon).length
    );
    expect(entry.stats.encountersFled).toBe(
      baseResult.encounters.filter((e) => !e.petWon).length
    );
  });
});

// ---------------------------------------------------------------------------
// AC-8: Arweave upload integration test (1 test)
// ---------------------------------------------------------------------------

describe('uploadAdventureLog — Arweave upload (AC-8)', () => {
  it('[P0] calls adapter.upload once with Buffer + correct mandatory tags, returns txId, mandatory tags override caller tags', async () => {
    const mockAdapter = makeMockAdapter('arweave-tx-123');
    const entry = generateAdventureLog(
      'blobbi-001',
      'kobold-caves',
      baseResult
    );

    // Caller tries to override 'App-Name' — mandatory tag must win
    const result = await uploadAdventureLog(
      {
        arweaveAdapter: mockAdapter,
        arweaveTags: { 'App-Name': 'custom-app', 'Extra-Tag': 'extra-value' },
      },
      entry
    );

    // Adapter called exactly once
    expect(mockAdapter.upload).toHaveBeenCalledTimes(1);

    const [calledBuffer, calledTags] = (mockAdapter.upload as jest.Mock).mock
      .calls[0] as [Buffer, Record<string, string>];

    // First arg is a Buffer containing JSON of entry
    expect(Buffer.isBuffer(calledBuffer)).toBe(true);
    expect(JSON.parse(calledBuffer.toString('utf8'))).toEqual(entry);

    // All mandatory tags present and correct
    expect(calledTags['Content-Type']).toBe('application/json');
    expect(calledTags['App-Name']).toBe('toon-pet-adventure-log'); // mandatory overrides caller
    expect(calledTags['Blobbi-Id']).toBe(entry.blobbiId);
    expect(calledTags['Dungeon-Id']).toBe(entry.dungeonId);
    expect(calledTags['Dungeon-Seed']).toBe(entry.dungeonSeed);
    expect(calledTags['Timestamp']).toBe(entry.timestamp);

    // Caller extra tag is present (non-conflicting pass-through)
    expect(calledTags['Extra-Tag']).toBe('extra-value');

    // Returns txId from adapter
    expect(result.txId).toBe('arweave-tx-123');
  });
});

// ---------------------------------------------------------------------------
// AC-9: Biography query integration test (1 test)
// ---------------------------------------------------------------------------

describe('uploadAdventureLog — biography query pattern (AC-9)', () => {
  it('[P0] tags for two uploads for the same blobbiId both include matching Blobbi-Id tag', async () => {
    const uploadCalls: { buffer: Buffer; tags: Record<string, string> }[] = [];
    const mockAdapter: ArweaveUploadAdapter = {
      upload: jest
        .fn()
        .mockImplementation(
          async (buf: Buffer, tags: Record<string, string>) => {
            uploadCalls.push({ buffer: buf, tags });
            return { txId: `tx-${uploadCalls.length}` };
          }
        ),
    };

    const resultA: DungeonRunResult = { ...baseResult, seed: 'seed-A' };
    const resultB: DungeonRunResult = {
      ...baseResult,
      seed: 'seed-B',
      encounters: [],
      lootFound: [],
      statDeltas: { hunger: 0, happiness: 0, health: 0, hygiene: 0, energy: 0 },
    };

    const entryA = generateAdventureLog(
      'blobbi-bio-001',
      'kobold-caves',
      resultA
    );
    const entryB = generateAdventureLog(
      'blobbi-bio-001',
      'shadow-cavern',
      resultB
    );

    await uploadAdventureLog({ arweaveAdapter: mockAdapter }, entryA);
    await uploadAdventureLog({ arweaveAdapter: mockAdapter }, entryB);

    // Two uploads performed
    expect(uploadCalls).toHaveLength(2);

    // Both entries share the same blobbiId and their tags reflect it
    // Use non-optional access: length check on line above guarantees both indices exist
    expect(uploadCalls[0]!.tags['Blobbi-Id']).toBe('blobbi-bio-001');
    expect(uploadCalls[1]!.tags['Blobbi-Id']).toBe('blobbi-bio-001');

    // Different dungeon IDs (distinct logs)
    expect(uploadCalls[0]!.tags['Dungeon-Id']).toBe('kobold-caves');
    expect(uploadCalls[1]!.tags['Dungeon-Id']).toBe('shadow-cavern');
  });
});
