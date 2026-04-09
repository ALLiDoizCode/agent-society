/**
 * Dungeon DVM Handler (Story 11-17)
 *
 * Factory that wraps DungeonGameEngine and statBridge as a kind:5250 compute
 * DVM handler. Parses TOON kind:5250 requests, validates ILP payment, runs
 * the dungeon, applies stat deltas, builds a kind:6250 result event, and
 * returns a base64-encoded payload.
 *
 * Also exports buildDungeonDvmSkillDescriptor for kind:10035 marketplace
 * advertisement.
 *
 * @module dungeon/dungeonDvmHandler
 */

import { DungeonGameEngine } from './DungeonGameEngine';
import {
  petStatsToDungeonStats,
  applyDungeonDeltaToStats,
  StatBridgeError,
} from './statBridge';
import { DungeonEngineError } from './types';
import type { DungeonConfig } from './types';
import type {
  HandlerContext,
  HandlerResponse,
  UnsignedEvent,
} from '../handler/types';
import type { StatValues } from '../engine/types';

// ============================================================
// Local SkillDescriptor shape (mirrors @toon-protocol/core SkillDescriptor)
// Defined locally to avoid adding @toon-protocol/core as a dependency of pet-dvm.
// Must match the interface in packages/pet-dvm/src/pricing/buildPetDvmSkillDescriptor.ts exactly.
// ============================================================

interface SkillDescriptor {
  name: string;
  version: string;
  kinds: number[];
  features: string[];
  inputSchema: Record<string, unknown>;
  pricing: Record<string, string>;
  models?: string[];
  attestation?: Record<string, unknown>;
  reputation?: Record<string, unknown>;
}

// ============================================================
// Config Types
// ============================================================

/**
 * Configuration for createDungeonDvmHandler factory.
 * Provided once at factory time; reused for every request.
 */
export interface DungeonDvmConfig {
  /** DungeonGameEngine configuration (map size, monster/loot tables). */
  dungeonConfig: DungeonConfig;
  /** Flat ILP price in USDC micro-units per dungeon run (bigint). Default: 10000n. */
  pricePerRun: bigint;
  /** Callback to publish optimistic Nostr events (kind:6250 results) to relay. */
  publishEvent: (event: UnsignedEvent) => Promise<void>;
  /**
   * Optional current pet stats resolver.
   * If provided, stats are resolved from the pet state hash — the pet-stats
   * tag in the request is IGNORED in this mode.
   * If omitted, stats are taken directly from the pet-stats tag in the request.
   */
  resolvePetStats?: (petStateHash: string) => Promise<StatValues> | StatValues;
}

/**
 * Configuration for buildDungeonDvmSkillDescriptor.
 */
export interface DungeonSkillDescriptorConfig {
  /** Machine-readable dungeon ID, e.g. 'kobold-caves'. Used as descriptor name. */
  dungeonId: string;
  /**
   * Human-readable dungeon name, e.g. 'Kobold Caves'.
   * Not included in the MVP SkillDescriptor output shape (which uses `dungeonId`
   * as the `name` field). Retained in the config for future use, e.g. a
   * `description` field in kind:10035 advertisement events.
   */
  dungeonName: string;
  /** ILP price in USDC micro-units per run. */
  pricePerRun: bigint;
  /** Max rooms from DungeonConfig. */
  maxRooms: number;
  /**
   * Optional capability feature list.
   * Defaults to ['dungeon-crawl', 'idle-mode', 'loot-system', 'pet-compatible'].
   */
  features?: string[];
}

// ============================================================
// Helpers
// ============================================================

/**
 * Maximum byte length for the seed string accepted in a kind:5250 request.
 * Guards against DoS via oversized seeds that would make hashSeed() O(n).
 * 512 bytes is generous for any legitimate dungeon seed.
 */
const MAX_SEED_LENGTH = 512;

/** Known stat field names — validated individually to prevent prototype-chain access. */
const STAT_FIELDS = [
  'hunger',
  'happiness',
  'health',
  'hygiene',
  'energy',
] as const;

/**
 * Type guard for valid StatValues parsed from JSON.
 * All five fields must be own-property finite numbers in [1, 100].
 * Uses Object.prototype.hasOwnProperty to prevent prototype pollution
 * from attacker-controlled JSON keys (__proto__, constructor, etc.).
 */
function isPetStatsJson(v: unknown): v is StatValues {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return STAT_FIELDS.every((k) => {
    if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
    const val = o[k];
    return (
      typeof val === 'number' && Number.isFinite(val) && val >= 1 && val <= 100
    );
  });
}

/**
 * Validate that a StatValues object returned from resolvePetStats has all
 * fields as own-property finite numbers in [1, 100]. Throws with a clear
 * message so the T00 handler catches it and blames the resolver contract.
 */
function assertResolvedStatsValid(stats: StatValues, context: string): void {
  for (const k of STAT_FIELDS) {
    const val = stats[k];
    if (
      typeof val !== 'number' ||
      !Number.isFinite(val) ||
      val < 1 ||
      val > 100
    ) {
      throw new Error(
        `${context}: resolved field "${k}" = ${val} is outside [1, 100] or not finite`
      );
    }
  }
}

// ============================================================
// Factory: createDungeonDvmHandler
// ============================================================

/**
 * Create a DVM handler for kind:5250 Dungeon Run requests.
 *
 * Constructs a DungeonGameEngine once at factory time (same pattern as
 * createPetDvmHandler). The returned handler is stateless per-request.
 *
 * Register with: HandlerRegistry.on(5250, createDungeonDvmHandler(config))
 */
export function createDungeonDvmHandler(
  config: DungeonDvmConfig
): (ctx: HandlerContext) => Promise<HandlerResponse> {
  // Construct engine ONCE at factory time (not per-request)
  const engine = new DungeonGameEngine(config.dungeonConfig);

  return async (ctx: HandlerContext): Promise<HandlerResponse> => {
    // ---- 1. Decode event once; reuse the variable ----
    const event = ctx.decode();

    const getTag = (name: string): string | undefined =>
      event.tags.find((t) => t[0] === name)?.[1];

    // ---- 2. Parse required tags ----
    const petStateHash = getTag('p-state');
    const dungeonId = getTag('dungeon');
    const seed = getTag('seed');
    const petStatsRaw = getTag('pet-stats');

    if (!petStateHash) {
      return {
        accept: false,
        code: 'F00',
        message: 'Missing required tag: p-state',
      };
    }
    if (!dungeonId) {
      return {
        accept: false,
        code: 'F00',
        message: 'Missing required tag: dungeon',
      };
    }
    if (!seed) {
      return {
        accept: false,
        code: 'F00',
        message: 'Missing required tag: seed',
      };
    }
    if (seed.trim() === '') {
      return {
        accept: false,
        code: 'F00',
        message: 'Invalid tag: seed must be a non-empty string',
      };
    }
    if (seed.length > MAX_SEED_LENGTH) {
      return {
        accept: false,
        code: 'F00',
        message: `Invalid tag: seed exceeds maximum length of ${MAX_SEED_LENGTH} characters`,
      };
    }

    // ---- 3. ILP payment validation ----
    if (ctx.amount < config.pricePerRun) {
      return {
        accept: false,
        code: 'F01',
        message: `Insufficient payment: required ${config.pricePerRun}, received ${ctx.amount}`,
      };
    }

    // ---- 4. Resolve pet stats ----
    let parsedPetStats: StatValues;

    if (config.resolvePetStats) {
      // Mode 1: resolve from pet state hash — ignore pet-stats tag.
      // Validate the resolver's return value: a misconfigured resolver returning
      // out-of-range values would otherwise propagate into engine/stat-bridge
      // with a confusing T00. Catch it here with a clear diagnostic.
      try {
        parsedPetStats = await config.resolvePetStats(petStateHash);
        assertResolvedStatsValid(parsedPetStats, 'resolvePetStats');
      } catch (err: unknown) {
        // Truncate message to avoid leaking excessive internal details to callers.
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg.length > 200 ? rawMsg.slice(0, 200) + '…' : rawMsg;
        return {
          accept: false,
          code: 'T00',
          message: `Failed to resolve pet stats: ${msg}`,
        };
      }
    } else {
      // Mode 2: parse from pet-stats tag
      if (!petStatsRaw) {
        return {
          accept: false,
          code: 'F00',
          message: 'Missing required tag: pet-stats',
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(petStatsRaw);
      } catch {
        return {
          accept: false,
          code: 'F00',
          message: 'Invalid pet-stats: JSON parse error',
        };
      }
      if (!isPetStatsJson(parsed)) {
        return {
          accept: false,
          code: 'F00',
          message:
            'Invalid pet-stats: all fields must be finite numbers in [1, 100]',
        };
      }
      parsedPetStats = parsed;
    }

    // ---- 5. Dungeon run pipeline ----
    let updatedStats: StatValues;
    let result: ReturnType<DungeonGameEngine['run']>;

    try {
      const dungeonStats = petStatsToDungeonStats(parsedPetStats);
      result = engine.run(seed, dungeonStats);
      updatedStats = applyDungeonDeltaToStats(
        parsedPetStats,
        result.statDeltas
      );
    } catch (err: unknown) {
      if (err instanceof DungeonEngineError) {
        return {
          accept: false,
          code: 'T00',
          message: `Dungeon engine error: ${err.code}`,
        };
      }
      if (err instanceof StatBridgeError) {
        return {
          accept: false,
          code: 'T00',
          message: `Stat bridge error: ${err.code}`,
        };
      }
      // Truncate to avoid leaking excessive internal details to callers.
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = rawMsg.length > 200 ? rawMsg.slice(0, 200) + '…' : rawMsg;
      return {
        accept: false,
        code: 'T00',
        message: `Unexpected dungeon error: ${msg}`,
      };
    }

    // ---- 6. Build kind:6250 result content ----
    const encountersWon = result.encounters.filter((e) => e.petWon).length;
    const encountersFled = result.encounters.filter((e) => !e.petWon).length;

    const content = {
      roomsGenerated: result.roomsGenerated,
      roomsVisited: result.roomsVisited,
      floorsReached: result.floorsReached,
      encountersWon,
      encountersFled,
      loot: result.lootFound,
      statDeltas: result.statDeltas,
      updatedStats,
      narrativeLog: result.narrativeSummary,
      dungeonSeed: seed,
      durationMs: result.durationMs,
    };

    // ---- 7. Build and fire-and-forget kind:6250 Nostr event ----
    const kind6250Event: UnsignedEvent = {
      kind: 6250,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['request', event.id],
        ['p-state-hash', petStateHash],
        ['dungeon', dungeonId],
        ['seed', seed],
        ['status', 'ok'],
      ],
      content: JSON.stringify(content),
    };

    // Fire-and-forget: publish errors must NOT cause the handler to reject
    config.publishEvent(kind6250Event).catch((err: unknown) => {
      console.warn(
        '[pet-dvm] Failed to publish kind:6250 dungeon result event:',
        err instanceof Error ? err.message : err
      );
    });

    // ---- 8. Return accept response ----
    // Reuse the already-serialized content string from kind6250Event to avoid
    // double JSON.stringify() on the same object.
    return {
      accept: true,
      data: Buffer.from(kind6250Event.content).toString('base64'),
    };
  };
}

// ============================================================
// buildDungeonDvmSkillDescriptor
// ============================================================

const DEFAULT_DUNGEON_FEATURES = [
  'dungeon-crawl',
  'idle-mode',
  'loot-system',
  'pet-compatible',
];

/**
 * Build a SkillDescriptor for advertising Dungeon DVM capabilities in
 * kind:10035 service discovery events.
 *
 * Pure function — no side effects, no I/O.
 */
export function buildDungeonDvmSkillDescriptor(
  config: DungeonSkillDescriptorConfig
): SkillDescriptor {
  return {
    name: config.dungeonId,
    version: '1.0',
    kinds: [5250],
    features:
      config.features != null
        ? [...config.features]
        : [...DEFAULT_DUNGEON_FEATURES],
    inputSchema: {
      type: 'object',
      required: ['p-state', 'dungeon', 'seed'],
      properties: {
        'p-state': { type: 'string' },
        dungeon: { type: 'string' },
        seed: { type: 'string' },
        'pet-stats': {
          type: 'string',
          description:
            'JSON-encoded StatValues (optional when server has resolvePetStats configured)',
        },
      },
    },
    pricing: {
      '5250': String(config.pricePerRun),
    },
  };
}
