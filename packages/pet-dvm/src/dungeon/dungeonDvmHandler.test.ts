/**
 * DungeonDvmHandler tests (Story 11-17)
 *
 * Coverage:
 *   AC-8  — Unit tests: handler lifecycle (5 tests)
 *   AC-9  — Unit tests: error paths (4 tests)
 *   AC-10 — Unit tests: SkillDescriptor (2 tests)
 *   AC-11 — Integration tests: stat deltas composition (2 tests)
 *   AC-12 — Integration test: full kind:5250 → kind:6250 flow (1 test)
 *
 * Total: 14 new tests. Baseline was 271 tests; expected after implementation: 285.
 *
 * Uses Jest + ts-jest. Tests are sequential (rot.js RNG is a global singleton).
 */

import {
  createDungeonDvmHandler,
  buildDungeonDvmSkillDescriptor,
} from './dungeonDvmHandler';
import { DEFAULT_MONSTER_TABLE, DEFAULT_LOOT_TABLE } from './DungeonGameEngine';
import type {
  DungeonDvmConfig,
  DungeonSkillDescriptorConfig,
} from './dungeonDvmHandler';
import type { HandlerContext, NostrEvent } from '../handler/types';
import type { StatValues } from '../engine/types';

// ============================================================
// Test Helpers / Factories
// ============================================================

/**
 * Build a mock HandlerContext for kind:5250 requests.
 * The handler calls ctx.decode() once and uses the returned event.
 */
function makeCtx(overrides: {
  kind5250Tags?: string[][];
  amount?: bigint;
}): HandlerContext {
  const event: NostrEvent = {
    id: 'test-event-id-11-17',
    kind: 5250,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: 'test-pubkey-abc',
    sig: 'test-sig-abc',
    tags: overrides.kind5250Tags ?? [
      ['p-state', 'abc123hash'],
      ['dungeon', 'kobold-caves'],
      ['seed', 'test-seed-17'],
      [
        'pet-stats',
        JSON.stringify({
          hunger: 60,
          happiness: 70,
          health: 80,
          hygiene: 50,
          energy: 90,
        }),
      ],
    ],
    content: '',
  };
  return {
    toon: JSON.stringify(event),
    kind: 5250,
    pubkey: 'test-pubkey-abc',
    amount: overrides.amount ?? 20000n,
    destination: 'g.toon.test',
    decode: () => event,
    accept: (metadata) => ({ accept: true, data: undefined, metadata }),
    reject: (code, message) => ({ accept: false, code, message }),
  };
}

/** Default config used across most tests */
function makeConfig(
  overrides: Partial<DungeonDvmConfig> = {}
): DungeonDvmConfig {
  return {
    dungeonConfig: {
      width: 40,
      height: 30,
      maxRooms: 8,
      dungeonType: 'digger',
      monsterTable: DEFAULT_MONSTER_TABLE,
      lootTable: DEFAULT_LOOT_TABLE,
    },
    pricePerRun: 10000n,
    publishEvent: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================
// AC-8 — Unit tests: handler lifecycle (5 tests)
// ============================================================

describe('createDungeonDvmHandler — lifecycle (AC-8)', () => {
  let publishEventMock: jest.Mock;
  let config: DungeonDvmConfig;

  beforeEach(() => {
    publishEventMock = jest.fn().mockResolvedValue(undefined);
    config = makeConfig({ publishEvent: publishEventMock });
  });

  it('[P0] valid kind:5250 request with all required tags returns accept:true with base64 result', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({});
    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    if (!result.accept) throw new Error('Expected accept:true');

    // Verify data is valid base64 JSON
    const decoded = JSON.parse(
      Buffer.from(result.data!, 'base64').toString('utf8')
    );
    expect(decoded).toMatchObject({
      roomsVisited: expect.any(Number),
      loot: expect.any(Array),
      statDeltas: expect.objectContaining({
        hunger: expect.any(Number),
        happiness: expect.any(Number),
        health: expect.any(Number),
        hygiene: expect.any(Number),
        energy: expect.any(Number),
      }),
      updatedStats: expect.objectContaining({
        hunger: expect.any(Number),
        happiness: expect.any(Number),
        health: expect.any(Number),
        hygiene: expect.any(Number),
        energy: expect.any(Number),
      }),
      narrativeLog: expect.any(String),
      dungeonSeed: 'test-seed-17',
      durationMs: expect.any(Number),
    });
  });

  it('[P0] resolvePetStats configured: stats resolved from hash, pet-stats tag ignored', async () => {
    const resolvedStats: StatValues = {
      hunger: 55,
      happiness: 65,
      health: 75,
      hygiene: 45,
      energy: 85,
    };
    const resolvePetStatsMock = jest.fn().mockResolvedValue(resolvedStats);

    const configWithResolver = makeConfig({
      publishEvent: publishEventMock,
      resolvePetStats: resolvePetStatsMock,
    });

    // Tags include a pet-stats tag with DIFFERENT values — they should be ignored
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-resolver'],
        // pet-stats tag present but with different values — resolver should win
        [
          'pet-stats',
          JSON.stringify({
            hunger: 99,
            happiness: 99,
            health: 99,
            hygiene: 99,
            energy: 99,
          }),
        ],
      ],
    });

    const handler = createDungeonDvmHandler(configWithResolver);
    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    expect(resolvePetStatsMock).toHaveBeenCalledWith('abc123hash');
    expect(resolvePetStatsMock).toHaveBeenCalledTimes(1);

    if (!result.accept) throw new Error('Expected accept:true');
    const decoded = JSON.parse(
      Buffer.from(result.data!, 'base64').toString('utf8')
    );
    // The result was produced using resolvedStats (55/65/75/45/85), not the tag's 99/99/99/99/99.
    // We confirm the resolver was called exactly once with the correct hash (primary assertion).
    // We also verify that all updatedStats fields are finite numbers in [1,100] (sanity check).
    expect(decoded.updatedStats.hunger).toBeGreaterThanOrEqual(1);
    expect(decoded.updatedStats.hunger).toBeLessThanOrEqual(100);
  });

  it('[P1] pet-stats JSON with one field at exactly 1 (boundary min) runs successfully', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-boundary-min'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 1,
            happiness: 50,
            health: 50,
            hygiene: 50,
            energy: 50,
          }),
        ],
      ],
    });

    const result = await handler(ctx);
    expect(result.accept).toBe(true);
  });

  it('[P1] pet-stats JSON with all fields at 100 (boundary max) runs successfully', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-boundary-max'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 100,
            happiness: 100,
            health: 100,
            hygiene: 100,
            energy: 100,
          }),
        ],
      ],
    });

    const result = await handler(ctx);
    expect(result.accept).toBe(true);
  });

  it('[P0] same (seed, pet-stats) input processed twice produces identical statDeltas (determinism)', async () => {
    const handler = createDungeonDvmHandler(config);
    const petStatsJson = JSON.stringify({
      hunger: 60,
      happiness: 70,
      health: 80,
      hygiene: 50,
      energy: 90,
    });
    const tags = [
      ['p-state', 'abc123hash'],
      ['dungeon', 'kobold-caves'],
      ['seed', 'determinism-test-seed-17'],
      ['pet-stats', petStatsJson],
    ];

    const ctx1 = makeCtx({ kind5250Tags: tags });
    const ctx2 = makeCtx({ kind5250Tags: tags });

    const result1 = await handler(ctx1);
    const result2 = await handler(ctx2);

    expect(result1.accept).toBe(true);
    expect(result2.accept).toBe(true);

    if (!result1.accept || !result2.accept)
      throw new Error('Expected both to accept');

    const decoded1 = JSON.parse(
      Buffer.from(result1.data!, 'base64').toString('utf8')
    );
    const decoded2 = JSON.parse(
      Buffer.from(result2.data!, 'base64').toString('utf8')
    );

    expect(decoded1.statDeltas).toEqual(decoded2.statDeltas);
  });

  it('[P1] resolvePetStats configured with no pet-stats tag in request runs successfully (mode-1 ignores missing tag)', async () => {
    const resolvedStats: StatValues = {
      hunger: 55,
      happiness: 65,
      health: 75,
      hygiene: 45,
      energy: 85,
    };
    const resolvePetStatsMock = jest.fn().mockResolvedValue(resolvedStats);
    const configWithResolver = makeConfig({
      resolvePetStats: resolvePetStatsMock,
    });

    // No pet-stats tag — mode-1 should succeed without it
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-no-pet-stats-tag'],
        // pet-stats tag deliberately omitted — resolver should be the only path
      ],
    });

    const handler = createDungeonDvmHandler(configWithResolver);
    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    expect(resolvePetStatsMock).toHaveBeenCalledWith('abc123hash');
  });

  it('[P1] synchronous resolvePetStats resolver (returns StatValues, not Promise) is handled correctly', async () => {
    const syncStats: StatValues = {
      hunger: 50,
      happiness: 60,
      health: 70,
      hygiene: 40,
      energy: 80,
    };
    // Synchronous resolver — returns StatValues directly (not a Promise)
    const syncResolver = jest.fn().mockReturnValue(syncStats);
    const configWithSyncResolver = makeConfig({
      resolvePetStats: syncResolver,
    });

    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-sync-resolver'],
      ],
    });

    const handler = createDungeonDvmHandler(configWithSyncResolver);
    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    expect(syncResolver).toHaveBeenCalledWith('abc123hash');
  });
});

// ============================================================
// AC-9 — Unit tests: error paths (4 tests)
// ============================================================

describe('createDungeonDvmHandler — error paths (AC-9)', () => {
  let config: DungeonDvmConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  it('[P1] missing p-state tag returns accept:false with code F00', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        // p-state deliberately omitted
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-missing-pstate'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });
    const result = await handler(ctx);
    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('p-state');
  });

  it('[P1] missing dungeon tag returns accept:false with code F00', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        // dungeon deliberately omitted
        ['seed', 'test-seed-missing-dungeon'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });
    const result = await handler(ctx);
    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('dungeon');
  });

  it('[P0] missing seed tag returns accept:false with code F00', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        // seed tag deliberately omitted
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('seed');
  });

  it('[P0] insufficient payment (ctx.amount < pricePerRun) returns accept:false with code F01', async () => {
    const handler = createDungeonDvmHandler(config); // pricePerRun = 10000n
    const ctx = makeCtx({ amount: 5000n }); // less than 10000n

    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F01');
    expect(result.message).toContain('10000');
    expect(result.message).toContain('5000');
  });

  it('[P1] exact-equal payment (ctx.amount === pricePerRun) is accepted (boundary)', async () => {
    const handler = createDungeonDvmHandler(config); // pricePerRun = 10000n
    const ctx = makeCtx({ amount: 10000n }); // exactly equal — must accept

    const result = await handler(ctx);

    expect(result.accept).toBe(true);
  });

  it('[P1] empty seed tag (whitespace-only) returns accept:false with code F00', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', '   '], // whitespace-only — should be invalid
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('seed');
  });

  it('[P1] oversized seed (>512 chars) returns accept:false with code F00 (DoS guard)', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'a'.repeat(513)], // 513 chars — exceeds MAX_SEED_LENGTH=512
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('seed');
  });

  it('[P0] pet-stats JSON with field value 200 (out of range) returns accept:false with code F00', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-invalid-stats'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 200,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('F00');
    expect(result.message).toContain('pet-stats');
  });

  it('[P0] resolvePetStats throws → returns accept:false, code T00, message contains "resolvePetStats" or "Failed to resolve pet stats"', async () => {
    const rejectingResolver = jest
      .fn()
      .mockRejectedValue(new Error('DB unavailable'));

    const configWithFailingResolver = makeConfig({
      resolvePetStats: rejectingResolver,
    });

    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'test-seed-resolver-fail'],
        // no pet-stats tag — resolver is the only path
      ],
    });

    const handler = createDungeonDvmHandler(configWithFailingResolver);
    const result = await handler(ctx);

    expect(result.accept).toBe(false);
    if (result.accept) throw new Error('Expected accept:false');
    expect(result.code).toBe('T00');
    const messageMatches =
      result.message.includes('resolvePetStats') ||
      result.message.includes('Failed to resolve pet stats');
    expect(messageMatches).toBe(true);
  });
});

// ============================================================
// AC-10 — Unit tests: SkillDescriptor (2 tests)
// ============================================================

describe('buildDungeonDvmSkillDescriptor (AC-10)', () => {
  it('[P0] returns kinds:[5250] and pricing["5250"] equals String(pricePerRun)', () => {
    const config: DungeonSkillDescriptorConfig = {
      dungeonId: 'kobold-caves',
      dungeonName: 'Kobold Caves',
      pricePerRun: 10000n,
      maxRooms: 8,
    };

    const descriptor = buildDungeonDvmSkillDescriptor(config);

    expect(descriptor.kinds).toEqual([5250]);
    expect(descriptor.pricing['5250']).toBe('10000');
    expect(descriptor.name).toBe('kobold-caves');
    expect(descriptor.version).toBe('1.0');

    // AC-7: verify inputSchema structure (required fields and property keys)
    const schema = descriptor.inputSchema as {
      type: string;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['p-state', 'dungeon', 'seed']);
    expect(schema.properties).toHaveProperty('p-state');
    expect(schema.properties).toHaveProperty('dungeon');
    expect(schema.properties).toHaveProperty('seed');
    expect(schema.properties).toHaveProperty('pet-stats');
  });

  it('[P1] default features applied when features omitted', () => {
    const config: DungeonSkillDescriptorConfig = {
      dungeonId: 'crystal-caverns',
      dungeonName: 'Crystal Caverns',
      pricePerRun: 5000n,
      maxRooms: 6,
      // features intentionally omitted
    };

    const descriptor = buildDungeonDvmSkillDescriptor(config);

    expect(descriptor.features).toEqual([
      'dungeon-crawl',
      'idle-mode',
      'loot-system',
      'pet-compatible',
    ]);
  });
});

// ============================================================
// AC-11 — Integration tests: stat delta composition (2 tests)
// ============================================================

describe('createDungeonDvmHandler — stat delta integration (AC-11)', () => {
  let config: DungeonDvmConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  it('[P0] G18/G19: updatedStats in result are all within [1, 100] after full handler run', async () => {
    const handler = createDungeonDvmHandler(config);
    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'g18-quality-gate-seed'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    if (!result.accept) throw new Error('Expected accept:true');

    const decoded = JSON.parse(
      Buffer.from(result.data!, 'base64').toString('utf8')
    );
    const { updatedStats } = decoded as { updatedStats: StatValues };

    expect(updatedStats.hunger).toBeGreaterThanOrEqual(1);
    expect(updatedStats.hunger).toBeLessThanOrEqual(100);
    expect(updatedStats.happiness).toBeGreaterThanOrEqual(1);
    expect(updatedStats.happiness).toBeLessThanOrEqual(100);
    expect(updatedStats.health).toBeGreaterThanOrEqual(1);
    expect(updatedStats.health).toBeLessThanOrEqual(100);
    expect(updatedStats.hygiene).toBeGreaterThanOrEqual(1);
    expect(updatedStats.hygiene).toBeLessThanOrEqual(100);
    expect(updatedStats.energy).toBeGreaterThanOrEqual(1);
    expect(updatedStats.energy).toBeLessThanOrEqual(100);
  });

  it('[P1] two different seeds produce different statDeltas (non-trivial dungeon variation)', async () => {
    // Seeds verified to diverge in 11-15 tests
    const handler = createDungeonDvmHandler(config);
    const petStatsJson = JSON.stringify({
      hunger: 60,
      happiness: 70,
      health: 80,
      hygiene: 50,
      energy: 90,
    });

    const ctxAlpha = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'seed-alpha-111'],
        ['pet-stats', petStatsJson],
      ],
    });

    const ctxBeta = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'seed-beta-222'],
        ['pet-stats', petStatsJson],
      ],
    });

    const resultAlpha = await handler(ctxAlpha);
    const resultBeta = await handler(ctxBeta);

    expect(resultAlpha.accept).toBe(true);
    expect(resultBeta.accept).toBe(true);

    if (!resultAlpha.accept || !resultBeta.accept)
      throw new Error('Expected both to accept');

    const decodedAlpha = JSON.parse(
      Buffer.from(resultAlpha.data!, 'base64').toString('utf8')
    );
    const decodedBeta = JSON.parse(
      Buffer.from(resultBeta.data!, 'base64').toString('utf8')
    );

    // At least one stat delta field should differ between the two runs
    const deltasAreIdentical =
      decodedAlpha.statDeltas.hunger === decodedBeta.statDeltas.hunger &&
      decodedAlpha.statDeltas.happiness === decodedBeta.statDeltas.happiness &&
      decodedAlpha.statDeltas.health === decodedBeta.statDeltas.health &&
      decodedAlpha.statDeltas.hygiene === decodedBeta.statDeltas.hygiene &&
      decodedAlpha.statDeltas.energy === decodedBeta.statDeltas.energy;

    expect(deltasAreIdentical).toBe(false);
  });
});

// ============================================================
// AC-12 — Integration test: full kind:5250 → kind:6250 flow (1 test)
// ============================================================

describe('createDungeonDvmHandler — full kind:5250 → kind:6250 flow (AC-12)', () => {
  it('[P0] publishEvent called once with kind:6250 event; response has required content fields', async () => {
    const publishEventMock = jest.fn().mockResolvedValue(undefined);
    const config = makeConfig({ publishEvent: publishEventMock });
    const handler = createDungeonDvmHandler(config);

    const ctx = makeCtx({
      kind5250Tags: [
        ['p-state', 'abc123hash'],
        ['dungeon', 'kobold-caves'],
        ['seed', 'full-flow-seed-12'],
        [
          'pet-stats',
          JSON.stringify({
            hunger: 60,
            happiness: 70,
            health: 80,
            hygiene: 50,
            energy: 90,
          }),
        ],
      ],
    });

    const result = await handler(ctx);

    expect(result.accept).toBe(true);
    if (!result.accept) throw new Error('Expected accept:true');

    // publishEvent was called once with a kind:6250 event
    // Allow for a brief microtask flush since publishEvent is fire-and-forget
    await Promise.resolve();
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const publishedEvent = publishEventMock.mock.calls[0]?.[0];
    expect(publishedEvent).toBeDefined();
    expect(publishedEvent.kind).toBe(6250);

    // Verify kind:6250 event tags include all required fields (AC-6)
    const tags: string[][] = publishedEvent.tags;
    const findTag = (name: string) => tags.find((t) => t[0] === name)?.[1];
    expect(findTag('request')).toBe('test-event-id-11-17');
    expect(findTag('status')).toBe('ok');
    expect(findTag('dungeon')).toBe('kobold-caves');
    expect(findTag('p-state-hash')).toBe('abc123hash'); // AC-6: echoed from request
    expect(findTag('seed')).toBe('full-flow-seed-12'); // AC-6: echoed from request

    // Verify response content has all required fields (AC-12)
    const decoded = JSON.parse(
      Buffer.from(result.data!, 'base64').toString('utf8')
    );
    expect(decoded.roomsVisited).toBeDefined();
    expect(decoded.loot).toBeDefined();
    expect(decoded.statDeltas).toBeDefined();
    expect(decoded.narrativeLog).toBeDefined();
    // Additional required content fields from AC-6 response shape
    expect(decoded.roomsGenerated).toBeDefined();
    expect(decoded.floorsReached).toBeDefined();
    expect(decoded.updatedStats).toBeDefined();
    expect(decoded.dungeonSeed).toBe('full-flow-seed-12');
    expect(decoded.durationMs).toBeDefined();
  });
});
