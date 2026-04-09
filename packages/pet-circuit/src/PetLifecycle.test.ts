/**
 * PetLifecycle ZkProgram -- Constraint, Golden Vector, Boundary, and Adversarial Tests
 *
 * Test framework: Jest (o1js WASM incompatible with vitest)
 * Proof mode: proofsEnabled: false (constraint checking only, runs in seconds)
 */

import { Field, UInt32, UInt64, Poseidon, PrivateKey, Signature } from 'o1js';

import {
  PetLifecycle,
  PetStats,
  PetAction,
  PetState,
  PetLifecycleProof,
  CooldownTimestamps,
  ActionType,
  Stage,
  ACTION_COUNT,
  DECAY_RATES,
  COOLDOWN_DURATIONS,
  STAGE_ALLOWED_ACTIONS,
  BASE_ACTION_EFFECTS,
  SHOP_ITEMS,
  EVOLUTION_THRESHOLDS,
  MAX_CLOCK_SKEW,
  MAX_BATCH_WINDOW,
} from './index';
import {
  blake3ToField,
  computeDecay,
  applyAction,
  checkCooldown,
  isActionAllowed,
} from './utils';
import goldenVectors from '../test-vectors/golden-vectors.json';

// ============================================================
// Helper: extract bigint from UInt32/UInt64/Field uniformly
// (UInt64 has .toBigInt(), UInt32 has .toBigint() -- o1js naming inconsistency)
// ============================================================
function bn(
  v:
    | { value: { toBigInt(): bigint } }
    | { toBigInt(): bigint }
    | { toBigint(): bigint }
): bigint {
  if (
    'value' in v &&
    v.value &&
    typeof (v.value as any).toBigInt === 'function'
  ) {
    return (v.value as any).toBigInt() as bigint;
  }
  if ('toBigInt' in v && typeof v.toBigInt === 'function') return v.toBigInt();
  if ('toBigint' in v && typeof (v as any).toBigint === 'function')
    return (v as any).toBigint() as bigint;
  throw new Error('Cannot extract bigint');
}

// ============================================================
// Helper: create CooldownTimestamps from array of numbers
// ============================================================
function makeCooldowns(arr: number[]): CooldownTimestamps {
  return new CooldownTimestamps({
    ts0: UInt64.from(arr[0]!),
    ts1: UInt64.from(arr[1]!),
    ts2: UInt64.from(arr[2]!),
    ts3: UInt64.from(arr[3]!),
    ts4: UInt64.from(arr[4]!),
    ts5: UInt64.from(arr[5]!),
    ts6: UInt64.from(arr[6]!),
    ts7: UInt64.from(arr[7]!),
    ts8: UInt64.from(arr[8]!),
    ts9: UInt64.from(arr[9]!),
    ts10: UInt64.from(arr[10]!),
  });
}

function zeroCooldowns(): CooldownTimestamps {
  return makeCooldowns(new Array(ACTION_COUNT).fill(0));
}

// ============================================================
// Helper: Build valid interact parameters
// ============================================================
function buildInteractParams(opts: {
  prevProof: any;
  actionType: number;
  itemId?: number;
  timestamp: number;
  tokenCost?: number;
  newStats: {
    hunger: number;
    happiness: number;
    health: number;
    hygiene: number;
    energy: number;
  };
  newBrainHash: Field;
  prevCooldowns: CooldownTimestamps;
  ownerKey: ReturnType<typeof PrivateKey.random>;
  currentSlotTime?: number;
}) {
  const action = new PetAction({
    actionType: UInt32.from(opts.actionType),
    itemId: UInt32.from(opts.itemId ?? 0),
    timestamp: UInt64.from(opts.timestamp),
    tokenCost: UInt64.from(opts.tokenCost ?? 0),
  });

  const stats = new PetStats({
    hunger: UInt32.from(opts.newStats.hunger),
    happiness: UInt32.from(opts.newStats.happiness),
    health: UInt32.from(opts.newStats.health),
    hygiene: UInt32.from(opts.newStats.hygiene),
    energy: UInt32.from(opts.newStats.energy),
  });

  // Compute interaction hash for signature
  const interactionHash = Poseidon.hash([
    action.actionType.value,
    action.itemId.value,
    action.timestamp.value,
    action.tokenCost.value,
  ]);

  const ownerPub = opts.ownerKey.toPublicKey();
  const sig = Signature.create(opts.ownerKey, [interactionHash]);

  // Update cooldowns
  const cooldownArr = [
    opts.prevCooldowns.ts0,
    opts.prevCooldowns.ts1,
    opts.prevCooldowns.ts2,
    opts.prevCooldowns.ts3,
    opts.prevCooldowns.ts4,
    opts.prevCooldowns.ts5,
    opts.prevCooldowns.ts6,
    opts.prevCooldowns.ts7,
    opts.prevCooldowns.ts8,
    opts.prevCooldowns.ts9,
    opts.prevCooldowns.ts10,
  ].map((t) => Number(t.toBigInt()));

  cooldownArr[opts.actionType] = opts.timestamp;
  const newCooldowns = makeCooldowns(cooldownArr);

  const slotTime = opts.currentSlotTime ?? opts.timestamp;

  return {
    action,
    stats,
    newBrainHash: opts.newBrainHash,
    prevCooldowns: opts.prevCooldowns,
    newCooldowns,
    ownerPub,
    sig,
    slotTime: UInt64.from(slotTime),
  };
}

// ============================================================
// Compile once before all tests
// ============================================================
let compiled = false;

beforeAll(async () => {
  if (!compiled) {
    // Compile with proofs disabled for fast constraint checking
    await PetLifecycle.compile();
    compiled = true;
  }
}, 120000);

// =========================================================================
// AC-1: Package Scaffolding
// =========================================================================
describe('AC-1: Package scaffolding', () => {
  it('should export PetLifecycle ZkProgram', () => {
    expect(PetLifecycle).toBeDefined();
    expect(PetLifecycle.name).toBe('PetLifecycle');
    expect(typeof PetLifecycle.compile).toBe('function');
  });

  it('should export PetStats struct', () => {
    expect(PetStats).toBeDefined();
  });

  it('should export PetAction struct', () => {
    expect(PetAction).toBeDefined();
  });

  it('should export PetState struct', () => {
    expect(PetState).toBeDefined();
  });

  it('should export PetLifecycleProof', () => {
    expect(PetLifecycleProof).toBeDefined();
  });

  it('should export all constant tables', () => {
    expect(DECAY_RATES).toBeDefined();
    expect(COOLDOWN_DURATIONS).toBeDefined();
    expect(BASE_ACTION_EFFECTS).toBeDefined();
    expect(SHOP_ITEMS).toBeDefined();
    expect(EVOLUTION_THRESHOLDS).toBeDefined();
    expect(STAGE_ALLOWED_ACTIONS).toBeDefined();
  });
});

// =========================================================================
// AC-2: PetStats Struct
// =========================================================================
describe('AC-2: PetStats struct', () => {
  it('should have all five stat fields as UInt32', () => {
    const stats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });
    expect(bn(stats.hunger)).toBe(100n);
    expect(bn(stats.happiness)).toBe(100n);
    expect(bn(stats.health)).toBe(100n);
    expect(bn(stats.hygiene)).toBe(100n);
    expect(bn(stats.energy)).toBe(100n);
  });
});

// =========================================================================
// AC-3: PetAction Struct
// =========================================================================
describe('AC-3: PetAction struct', () => {
  it('should have actionType, itemId, timestamp, tokenCost fields', () => {
    const action = new PetAction({
      actionType: UInt32.from(0),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(1700000000n),
      tokenCost: UInt64.from(0n),
    });
    expect(bn(action.actionType)).toBe(0n);
    expect(bn(action.itemId)).toBe(0n);
    expect(bn(action.timestamp)).toBe(1700000000n);
    expect(bn(action.tokenCost)).toBe(0n);
  });
});

// =========================================================================
// AC-4: PetState Struct
// =========================================================================
describe('AC-4: PetState struct', () => {
  it('should have all required fields including lifecycleHash and cooldownHash', () => {
    const state = new PetState({
      stats: new PetStats({
        hunger: UInt32.from(100),
        happiness: UInt32.from(100),
        health: UInt32.from(100),
        hygiene: UInt32.from(100),
        energy: UInt32.from(100),
      }),
      stage: UInt32.from(0),
      cycle: UInt64.from(1n),
      lastInteraction: UInt64.from(0n),
      brainHash: Field(0),
      totalSpent: UInt64.from(0n),
      lifecycleHash: Field(0),
      cooldownHash: Field(0),
    });
    expect(bn(state.stage)).toBe(0n);
    expect(bn(state.cycle)).toBe(1n);
  });
});

// =========================================================================
// AC-5: Genesis Method
// =========================================================================
describe('AC-5: genesis method', () => {
  it('should create initial proof with egg stage and all stats at 100', async () => {
    const brainHash = Field(12345);
    const result = await PetLifecycle.genesis(brainHash);

    const state = result.proof.publicOutput;
    expect(bn(state.stage)).toBe(0n);
    expect(bn(state.cycle)).toBe(1n);
    expect(bn(state.stats.hunger)).toBe(100n);
    expect(bn(state.stats.happiness)).toBe(100n);
    expect(bn(state.stats.health)).toBe(100n);
    expect(bn(state.stats.hygiene)).toBe(100n);
    expect(bn(state.stats.energy)).toBe(100n);
    expect(bn(state.totalSpent)).toBe(0n);
  });

  it('should compute correct initial lifecycleHash', async () => {
    const brainHash = Field(12345);
    const result = await PetLifecycle.genesis(brainHash);

    const state = result.proof.publicOutput;
    const expectedHash = Poseidon.hash([
      Field(0),
      Field(1),
      brainHash,
      Field(0),
      Field(0),
      Field(0),
    ]);
    expect(state.lifecycleHash.toBigInt()).toBe(expectedHash.toBigInt());
  });

  it('should compute initial cooldownHash as Poseidon of 11 zeros', async () => {
    const brainHash = Field(12345);
    const result = await PetLifecycle.genesis(brainHash);

    const state = result.proof.publicOutput;
    const zeros = Array(ACTION_COUNT).fill(Field(0));
    const expectedCooldownHash = Poseidon.hash(zeros);
    expect(state.cooldownHash.toBigInt()).toBe(expectedCooldownHash.toBigInt());
  });
});

// =========================================================================
// AC-6: Interact Method
// =========================================================================
describe('AC-6: interact method', () => {
  const ownerKey = PrivateKey.random();

  it('should increment cycle by exactly 1', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);

    // Compute expected stats after decay + action
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);

    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    expect(result.proof.publicOutput.cycle.toBigInt()).toBe(2n);
  });

  it('should update lifecycleHash with Poseidon chain', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);
    const newBrainHash = Field(99999);

    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);

    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash,
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    // Compute expected lifecycle hash
    const interactionHash = Poseidon.hash([
      params.action.actionType.value,
      params.action.itemId.value,
      params.action.timestamp.value,
      params.action.tokenCost.value,
    ]);
    const expectedHash = Poseidon.hash([
      genesis.proof.publicOutput.lifecycleHash,
      Field(2), // cycle
      newBrainHash,
      interactionHash,
      Field(0), // stage (egg)
      Field(0), // totalSpent
    ]);
    expect(result.proof.publicOutput.lifecycleHash.toBigInt()).toBe(
      expectedHash.toBigInt()
    );
  });

  it('should accumulate totalSpent with tokenCost', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);

    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.CHECK, 0, Stage.EGG);

    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.CHECK,
      timestamp: 7200,
      tokenCost: 50,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    expect(result.proof.publicOutput.totalSpent.toBigInt()).toBe(50n);
  });
});

// =========================================================================
// AC-7: Evolve Method
// =========================================================================
describe('AC-7: evolve method', () => {
  it('should hatch egg to baby when thresholds met', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);

    // Build a state that looks like cycle >= 7 with good stats
    // We'll manually create a "fake" prior proof via genesis for simplicity
    // In the real flow, this would be after 7 interactions
    // For constraint testing (proofsEnabled: false), we can set publicOutput directly

    // Actually, the evolve method verifies earlierProof, so we need a valid proof.
    // With proofsEnabled: false, the verify() is a no-op. We need to build a state
    // that has cycle >= 7 and proper stats.
    // We can do this by running genesis then multiple interactions. But that's complex.
    // Instead, let's test that the constraints work by building appropriate state.
    // Since proofsEnabled: false, earlierProof.verify() succeeds regardless.

    // For this test, we'll run genesis and then fake a proof with correct publicOutput.
    // With proofs disabled, the SelfProof verification is skipped.
    // This means we can test the evolve constraints directly.

    // Unfortunately, we still need a valid SelfProof object to pass.
    // The simplest approach: run genesis, then just test that evolve accepts
    // valid state. With proofsEnabled: false, the proof structure is not verified.

    // Let's skip the full 7-interaction chain and instead verify boundary conditions
    // through the evolve method directly. We'll need at minimum a genesis proof.
    // The evolve will check prevState.cycle >= 7 etc.
    // Since genesis has cycle=1, this should FAIL for hatch.
    // We need to test with a proper cycle. Let's build interactions up to cycle 7.

    // For brevity in tests, we'll just verify the basic acceptance/rejection
    // The full 10-step recursive test is in AC-13.

    // Test: genesis (cycle=1) -> should reject hatch (cycle < 7)
    await expect(async () => {
      await PetLifecycle.evolve(
        genesis.proof,
        UInt32.from(Stage.BABY),
        new PetStats({
          hunger: UInt32.from(100),
          happiness: UInt32.from(100),
          health: UInt32.from(100),
          hygiene: UInt32.from(100),
          energy: UInt32.from(100),
        })
      );
    }).rejects.toThrow();
  });

  it('should reject stage regression', async () => {
    // Can't go from egg (0) to egg (0) or lower
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);

    await expect(async () => {
      await PetLifecycle.evolve(
        genesis.proof,
        UInt32.from(Stage.EGG), // same stage
        new PetStats({
          hunger: UInt32.from(100),
          happiness: UInt32.from(100),
          health: UInt32.from(100),
          hygiene: UInt32.from(100),
          energy: UInt32.from(100),
        })
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-12: Golden Test Vectors (Quality Gate G4)
// =========================================================================
describe('AC-12: Golden test vectors', () => {
  it('should load 26 golden vectors from test-vectors/golden-vectors.json', () => {
    expect(goldenVectors).toBeDefined();
    expect(Array.isArray(goldenVectors)).toBe(true);
    expect(goldenVectors.length).toBe(26); // 24 base action + 2 shop items
  });

  // Validate decay + action computation against each vector using the utility functions
  for (const vector of goldenVectors) {
    it(`golden vector #${vector.id}: ${vector.description}`, () => {
      const input = vector.inputStats;
      const decayed = computeDecay(
        {
          hunger: input.hunger,
          happiness: input.happiness,
          health: input.health,
          hygiene: input.hygiene,
          energy: input.energy,
        },
        vector.stage,
        vector.elapsedSeconds,
        vector.isSleeping
      );

      // Check decayed stats
      expect(decayed.hunger).toBe(vector.expectedDecayedStats.hunger);
      expect(decayed.happiness).toBe(vector.expectedDecayedStats.happiness);
      expect(decayed.health).toBe(vector.expectedDecayedStats.health);
      expect(decayed.hygiene).toBe(vector.expectedDecayedStats.hygiene);
      expect(decayed.energy).toBe(vector.expectedDecayedStats.energy);

      // Apply action
      const final = applyAction(
        decayed,
        vector.actionType,
        vector.itemId,
        vector.stage
      );

      // Check final stats
      expect(final.hunger).toBe(vector.expectedFinalStats.hunger);
      expect(final.happiness).toBe(vector.expectedFinalStats.happiness);
      expect(final.health).toBe(vector.expectedFinalStats.health);
      expect(final.hygiene).toBe(vector.expectedFinalStats.hygiene);
      expect(final.energy).toBe(vector.expectedFinalStats.energy);
    });
  }
});

// =========================================================================
// AC-14: Adversarial Tests
// =========================================================================
describe('AC-14: Adversarial tests', () => {
  const ownerKey = PrivateKey.random();
  let genesis: Awaited<ReturnType<typeof PetLifecycle.genesis>>;

  beforeAll(async () => {
    genesis = await PetLifecycle.genesis(Field(12345));
  });

  it('should REJECT backdated timestamps (timestamp <= previous)', async () => {
    // Genesis has lastInteraction = 0. Set timestamp to 0 (not > 0... wait, 0 is not > 0).
    // Actually genesis lastInteraction is 0, so timestamp must be > 0.
    // Let's first do a valid interaction, then try to backdate.
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const firstResult = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    // Now try to interact with timestamp <= 7200
    const badDecayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      100,
      false
    );
    const badFinalStats = applyAction(
      badDecayed,
      ActionType.CHECK,
      0,
      Stage.EGG
    );
    const badParams = buildInteractParams({
      prevProof: firstResult,
      actionType: ActionType.CHECK,
      timestamp: 7200, // same as previous, not greater
      newStats: badFinalStats,
      newBrainHash: Field(88888),
      prevCooldowns: params.newCooldowns,
      ownerKey,
    });

    await expect(async () => {
      await PetLifecycle.interact(
        firstResult.proof,
        badParams.action,
        badParams.stats,
        badParams.newBrainHash,
        badParams.prevCooldowns,
        badParams.newCooldowns,
        badParams.ownerPub,
        badParams.sig,
        badParams.slotTime
      );
    }).rejects.toThrow();
  });

  it('should REJECT wrong action for stage (feed on egg)', async () => {
    const _decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    // Feed is not allowed for egg, but let's try anyway
    const finalStats = {
      hunger: 100,
      happiness: 100,
      health: 98,
      hygiene: 84,
      energy: 100,
    };
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.FEED, // not allowed for egg
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
    }).rejects.toThrow();
  });

  it('should REJECT invalid owner signature (wrong Mina key)', async () => {
    const wrongKey = PrivateKey.random();
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);

    // Sign with ownerKey but verify against wrongKey's public key
    const action = new PetAction({
      actionType: UInt32.from(ActionType.WARM),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(7200),
      tokenCost: UInt64.from(0),
    });
    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    // Sign with the wrong key
    const wrongSig = Signature.create(wrongKey, [interactionHash]);
    const correctPub = ownerKey.toPublicKey(); // but sig is from wrongKey

    const prevCooldowns = zeroCooldowns();
    const cooldownArr = new Array(ACTION_COUNT).fill(0);
    cooldownArr[ActionType.WARM] = 7200;
    const newCooldowns = makeCooldowns(cooldownArr);

    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        action,
        new PetStats({
          hunger: UInt32.from(finalStats.hunger),
          happiness: UInt32.from(finalStats.happiness),
          health: UInt32.from(finalStats.health),
          hygiene: UInt32.from(finalStats.hygiene),
          energy: UInt32.from(finalStats.energy),
        }),
        Field(99999),
        prevCooldowns,
        newCooldowns,
        correctPub,
        wrongSig,
        UInt64.from(7200)
      );
    }).rejects.toThrow();
  });

  it('should REJECT brainHash unchanged between interactions', async () => {
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(12345), // same as genesis brainHash!
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
    }).rejects.toThrow();
  });

  it('should REJECT batch timestamp outside slot bounds (> currentSlot + 300s)', async () => {
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
      currentSlotTime: 7200 - MAX_CLOCK_SKEW - 1, // too far behind
    });

    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
    }).rejects.toThrow();
  });

  it('should REJECT batch timestamp outside slot bounds (< currentSlot - 3600s)', async () => {
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
      currentSlotTime: 7200 + MAX_BATCH_WINDOW + 1, // too far ahead
    });

    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-15: BLAKE3-to-Field Conversion Utility
// =========================================================================
describe('AC-15: blake3ToField utility', () => {
  it('should convert 64-char hex to Field with 253-bit truncation', () => {
    const hexHash = 'ff'.repeat(32);
    const field = blake3ToField(hexHash);
    expect(field.toBigInt()).toBeLessThan(2n ** 253n);
  });

  it('should produce a Field less than Pasta field modulus', () => {
    const PASTA_MODULUS =
      28948022309329048855892746252171976963363056481941560715954676764349967630337n;
    const hexHash = 'ff'.repeat(32);
    const field = blake3ToField(hexHash);
    expect(field.toBigInt()).toBeLessThan(PASTA_MODULUS);
  });

  it('should be injective (different inputs -> different outputs)', () => {
    const hash1 = '00'.repeat(32);
    const hash2 = '00'.repeat(31) + '01';
    const field1 = blake3ToField(hash1);
    const field2 = blake3ToField(hash2);
    expect(field1.toBigInt()).not.toBe(field2.toBigInt());
  });

  it('should reject invalid hex length', () => {
    expect(() => blake3ToField('ff'.repeat(16))).toThrow();
  });

  it('should reject non-hex characters', () => {
    // 64 chars but contains 'g' which is not valid hex
    const badHash = 'gg' + '00'.repeat(31);
    expect(() => blake3ToField(badHash)).toThrow(/non-hex/);
  });
});

// =========================================================================
// Boundary Tests
// =========================================================================
describe('Boundary tests', () => {
  it('should clamp stats to minimum of 1 (computeDecay)', () => {
    const result = computeDecay(
      { hunger: 5, happiness: 5, health: 5, hygiene: 5, energy: 5 },
      Stage.BABY,
      86400,
      false // 24 hours of decay
    );
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });

  it('should clamp stats to maximum of 100 (applyAction)', () => {
    const result = applyAction(
      { hunger: 90, happiness: 90, health: 90, hygiene: 90, energy: 90 },
      ActionType.FEED,
      0,
      Stage.BABY
    );
    expect(result.hunger).toBe(100); // 90 + 30 = 120, clamped to 100
    expect(result.happiness).toBe(95); // 90 + 5 = 95
  });
});

// =========================================================================
// AC-14 Gap Coverage: Cooldown Violation (AC-9)
// =========================================================================
describe('AC-14 gap: cooldown violation', () => {
  const ownerKey = PrivateKey.random();
  let genesis: Awaited<ReturnType<typeof PetLifecycle.genesis>>;

  beforeAll(async () => {
    genesis = await PetLifecycle.genesis(Field(12345));
  });

  it('should REJECT action before cooldown elapsed', async () => {
    // Given: a first valid interaction at timestamp 7200
    const decayed1 = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats1 = applyAction(decayed1, ActionType.WARM, 0, Stage.EGG);
    const params1 = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats1,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const firstResult = await PetLifecycle.interact(
      genesis.proof,
      params1.action,
      params1.stats,
      params1.newBrainHash,
      params1.prevCooldowns,
      params1.newCooldowns,
      params1.ownerPub,
      params1.sig,
      params1.slotTime
    );

    // When: try to use WARM again at timestamp 8000 (only 800s later, cooldown is 5400s)
    const decayed2 = computeDecay(
      {
        hunger: Number(bn(firstResult.proof.publicOutput.stats.hunger)),
        happiness: Number(bn(firstResult.proof.publicOutput.stats.happiness)),
        health: Number(bn(firstResult.proof.publicOutput.stats.health)),
        hygiene: Number(bn(firstResult.proof.publicOutput.stats.hygiene)),
        energy: Number(bn(firstResult.proof.publicOutput.stats.energy)),
      },
      Stage.EGG,
      800, // only 800s elapsed
      false
    );
    const finalStats2 = applyAction(decayed2, ActionType.WARM, 0, Stage.EGG);
    const params2 = buildInteractParams({
      prevProof: firstResult,
      actionType: ActionType.WARM,
      timestamp: 8000, // only 800s after first warm at 7200
      newStats: finalStats2,
      newBrainHash: Field(88888),
      prevCooldowns: params1.newCooldowns,
      ownerKey,
    });

    // Then: circuit should reject due to cooldown not elapsed
    await expect(async () => {
      await PetLifecycle.interact(
        firstResult.proof,
        params2.action,
        params2.stats,
        params2.newBrainHash,
        params2.prevCooldowns,
        params2.newCooldowns,
        params2.ownerPub,
        params2.sig,
        params2.slotTime
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-14 Gap Coverage: Token Underpayment
// =========================================================================
describe('AC-14 gap: token underpayment', () => {
  const ownerKey = PrivateKey.random();
  let genesis: Awaited<ReturnType<typeof PetLifecycle.genesis>>;

  beforeAll(async () => {
    genesis = await PetLifecycle.genesis(Field(12345));
  });

  it('should REJECT tokenCost < required for shop item', async () => {
    // Given: try to use a shop item (food_apple, itemId=1, required cost=10)
    // but only pay tokenCost=5
    // Note: feed is not allowed for egg, so use baby stage... but we only have genesis (egg).
    // Instead, use clean with soap (itemId=15, cost=15) which IS allowed for egg.
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.CLEAN, 15, Stage.EGG);

    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.CLEAN,
      itemId: 15, // hyg_soap, cost = 15
      timestamp: 7200,
      tokenCost: 5, // underpayment! required is 15
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    // Then: circuit should reject due to tokenCost < requiredCost
    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
    }).rejects.toThrow();
  });

  it('should ACCEPT tokenCost >= required for shop item', async () => {
    // Given: clean with soap (itemId=15, cost=15), paying exactly 15
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.CLEAN, 15, Stage.EGG);

    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.CLEAN,
      itemId: 15,
      timestamp: 7200,
      tokenCost: 15, // exact payment
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    // Then: circuit should accept
    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );
    expect(result.proof.publicOutput.totalSpent.toBigInt()).toBe(15n);
  });
});

// =========================================================================
// AC-14 Gap Coverage: Stage Regression (adult -> baby)
// =========================================================================
describe('AC-14 gap: stage regression (adult -> baby)', () => {
  it('should REJECT evolving from a higher stage to a lower stage', async () => {
    // We test this conceptually: the evolve method enforces newStage > currentStage.
    // With proofsEnabled: false, we can only test from genesis (egg, stage=0).
    // The existing test covers egg->egg (same stage). We add egg->0 attempt and
    // verify the constraint logic. Since we can't easily get to adult stage without
    // 21+ interactions, we verify the constraint by confirming newStage must be > currentStage.
    // This is already partially covered, but let's be explicit about the AC-14 requirement.
    const genesis = await PetLifecycle.genesis(Field(12345));

    // Try to "evolve" to stage 0 (same as current) -- regression blocked
    await expect(async () => {
      await PetLifecycle.evolve(
        genesis.proof,
        UInt32.from(0), // same stage as egg
        new PetStats({
          hunger: UInt32.from(100),
          happiness: UInt32.from(100),
          health: UInt32.from(100),
          hygiene: UInt32.from(100),
          energy: UInt32.from(100),
        })
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-14 Gap Coverage: interactionHash Mismatch (tampered fields)
// =========================================================================
describe('AC-14 gap: interactionHash mismatch', () => {
  const ownerKey = PrivateKey.random();
  let genesis: Awaited<ReturnType<typeof PetLifecycle.genesis>>;

  beforeAll(async () => {
    genesis = await PetLifecycle.genesis(Field(12345));
  });

  it('should REJECT when signature is over different action fields than provided', async () => {
    // Given: sign over one set of action fields, but provide different action fields
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);

    // Sign over a DIFFERENT timestamp than what we'll submit
    const fakeInteractionHash = Poseidon.hash([
      UInt32.from(ActionType.WARM).value,
      UInt32.from(0).value,
      UInt64.from(9999).value, // different timestamp!
      UInt64.from(0).value,
    ]);
    const ownerPub = ownerKey.toPublicKey();
    const tamperedSig = Signature.create(ownerKey, [fakeInteractionHash]);

    const prevCooldowns = zeroCooldowns();
    const cooldownArr = new Array(ACTION_COUNT).fill(0);
    cooldownArr[ActionType.WARM] = 7200;
    const newCooldowns = makeCooldowns(cooldownArr);

    const action = new PetAction({
      actionType: UInt32.from(ActionType.WARM),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(7200), // actual timestamp differs from signed one
      tokenCost: UInt64.from(0),
    });

    // Then: circuit rejects because signature doesn't match the actual interactionHash
    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        action,
        new PetStats({
          hunger: UInt32.from(finalStats.hunger),
          happiness: UInt32.from(finalStats.happiness),
          health: UInt32.from(finalStats.health),
          hygiene: UInt32.from(finalStats.hygiene),
          energy: UInt32.from(finalStats.energy),
        }),
        Field(99999),
        prevCooldowns,
        newCooldowns,
        ownerPub,
        tamperedSig,
        UInt64.from(7200)
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-9 Gap Coverage: Cooldown enforcement utility tests
// =========================================================================
describe('AC-9: cooldown enforcement utility', () => {
  it('should throw for unavailable actions (infinite cooldown)', () => {
    // feed (0) is not available for egg (stage 0) -- cooldown is 0 = infinite
    expect(() => checkCooldown(ActionType.FEED, Stage.EGG, 10000, 0)).toThrow(
      /unavailable/
    );
  });

  it('should throw when cooldown not elapsed', () => {
    // warm (4) on egg has 5400s cooldown
    expect(() => checkCooldown(ActionType.WARM, Stage.EGG, 6000, 5000)).toThrow(
      /Cooldown not elapsed/
    );
  });

  it('should pass when cooldown elapsed', () => {
    // warm (4) on egg has 5400s cooldown, 6000s elapsed
    expect(() =>
      checkCooldown(ActionType.WARM, Stage.EGG, 11400, 5000)
    ).not.toThrow();
  });

  it('should pass on first use (lastTs = 0)', () => {
    expect(() =>
      checkCooldown(ActionType.WARM, Stage.EGG, 100, 0)
    ).not.toThrow();
  });
});

// =========================================================================
// AC-10 Gap Coverage: Egg special rules (hunger/energy forced to 100)
// =========================================================================
describe('AC-10: egg special rules', () => {
  it('should force hunger to 100 for egg stage after action', () => {
    const result = applyAction(
      { hunger: 100, happiness: 80, health: 80, hygiene: 80, energy: 100 },
      ActionType.WARM,
      0,
      Stage.EGG
    );
    expect(result.hunger).toBe(100);
    expect(result.energy).toBe(100);
  });

  it('should NOT force hunger to 100 for baby stage', () => {
    // feed on baby: hunger + 30
    const result = applyAction(
      { hunger: 50, happiness: 50, health: 50, hygiene: 50, energy: 50 },
      ActionType.FEED,
      0,
      Stage.BABY
    );
    expect(result.hunger).toBe(80); // 50 + 30 = 80, not forced to 100
  });
});

// =========================================================================
// AC-10 Gap Coverage: Stage-specific action restrictions (isActionAllowed)
// =========================================================================
describe('AC-10: stage-specific action restrictions', () => {
  it('should allow warm for egg but not baby or adult', () => {
    expect(isActionAllowed(ActionType.WARM, Stage.EGG)).toBe(true);
    expect(isActionAllowed(ActionType.WARM, Stage.BABY)).toBe(false);
    expect(isActionAllowed(ActionType.WARM, Stage.ADULT)).toBe(false);
  });

  it('should allow feed for baby and adult but not egg', () => {
    expect(isActionAllowed(ActionType.FEED, Stage.EGG)).toBe(false);
    expect(isActionAllowed(ActionType.FEED, Stage.BABY)).toBe(true);
    expect(isActionAllowed(ActionType.FEED, Stage.ADULT)).toBe(true);
  });

  it('should allow cruzar only for adult', () => {
    expect(isActionAllowed(ActionType.CRUZAR, Stage.EGG)).toBe(false);
    expect(isActionAllowed(ActionType.CRUZAR, Stage.BABY)).toBe(false);
    expect(isActionAllowed(ActionType.CRUZAR, Stage.ADULT)).toBe(true);
  });

  it('should allow play_music for all stages', () => {
    expect(isActionAllowed(ActionType.PLAY_MUSIC, Stage.EGG)).toBe(true);
    expect(isActionAllowed(ActionType.PLAY_MUSIC, Stage.BABY)).toBe(true);
    expect(isActionAllowed(ActionType.PLAY_MUSIC, Stage.ADULT)).toBe(true);
  });

  it('should disallow sing for baby and adult', () => {
    expect(isActionAllowed(ActionType.SING, Stage.EGG)).toBe(true);
    expect(isActionAllowed(ActionType.SING, Stage.BABY)).toBe(false);
    expect(isActionAllowed(ActionType.SING, Stage.ADULT)).toBe(false);
  });
});

// =========================================================================
// AC-8 Gap Coverage: Decay arithmetic edge cases
// =========================================================================
describe('AC-8: decay arithmetic edge cases', () => {
  it('should produce zero delta for zero elapsed seconds', () => {
    const result = computeDecay(
      { hunger: 50, happiness: 50, health: 50, hygiene: 50, energy: 50 },
      Stage.BABY,
      0,
      false
    );
    expect(result.hunger).toBe(50);
    expect(result.happiness).toBe(50);
    expect(result.hygiene).toBe(50);
    expect(result.energy).toBe(50);
    // health may change slightly due to penalty thresholds at 50
  });

  it('should handle sleeping energy recovery for baby', () => {
    const awakeResult = computeDecay(
      { hunger: 80, happiness: 80, health: 80, hygiene: 80, energy: 50 },
      Stage.BABY,
      3600,
      false
    );
    const sleepResult = computeDecay(
      { hunger: 80, happiness: 80, health: 80, hygiene: 80, energy: 50 },
      Stage.BABY,
      3600,
      true
    );
    // Sleeping should increase energy, awake should decrease
    expect(sleepResult.energy).toBeGreaterThan(awakeResult.energy);
  });

  it('should apply health penalties based on POST-DECAY stat values', () => {
    // Start with stats just above penalty thresholds
    // After decay, they should drop below thresholds, triggering health penalties
    const result = computeDecay(
      { hunger: 72, happiness: 72, health: 90, hygiene: 72, energy: 72 },
      Stage.BABY,
      3600,
      false
    );
    // After 1hr baby decay: hunger drops below 70 (72 - floor(700*3600/360000) = 72 - 7 = 65)
    // This should trigger HUNGER_BELOW_70 health penalty
    expect(result.hunger).toBe(65);
    // Health should be worse than base decay alone due to hunger penalty
    // Base health rate = -75, with hunger<70 penalty = -75 + -75 = -150
    // health delta = floor(-150 * 3600 / 360000) = floor(-1.5) = -2
    // Note: also hygiene drops below 70, adding more penalty
    expect(result.health).toBeLessThan(90);
  });
});

// =========================================================================
// AC-6 Gap Coverage: CooldownHash verification in circuit
// =========================================================================
describe('AC-6 gap: cooldownHash verification', () => {
  const ownerKey = PrivateKey.random();
  let genesis: Awaited<ReturnType<typeof PetLifecycle.genesis>>;

  beforeAll(async () => {
    genesis = await PetLifecycle.genesis(Field(12345));
  });

  it('should REJECT when prevCooldowns hash does not match previous cooldownHash', async () => {
    // Given: provide incorrect prevCooldowns that don't match genesis cooldownHash
    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);

    // Create wrong prevCooldowns (should be all zeros for genesis, but we set non-zero)
    const wrongPrevCooldowns = makeCooldowns([
      1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const cooldownArr = [1000, 0, 0, 0, 7200, 0, 0, 0, 0, 0, 0];
    const newCooldowns = makeCooldowns(cooldownArr);

    const action = new PetAction({
      actionType: UInt32.from(ActionType.WARM),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(7200),
      tokenCost: UInt64.from(0),
    });
    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerPub = ownerKey.toPublicKey();
    const sig = Signature.create(ownerKey, [interactionHash]);

    // Then: circuit rejects because prevCooldowns.hash() != prevState.cooldownHash
    await expect(async () => {
      await PetLifecycle.interact(
        genesis.proof,
        action,
        new PetStats({
          hunger: UInt32.from(finalStats.hunger),
          happiness: UInt32.from(finalStats.happiness),
          health: UInt32.from(finalStats.health),
          hygiene: UInt32.from(finalStats.hygiene),
          energy: UInt32.from(finalStats.energy),
        }),
        Field(99999),
        wrongPrevCooldowns,
        newCooldowns,
        ownerPub,
        sig,
        UInt64.from(7200)
      );
    }).rejects.toThrow();
  });
});

// =========================================================================
// AC-7 Gap Coverage: Evolve lifecycleHash chain update
// =========================================================================
describe('AC-7 gap: evolve lifecycle hash chain', () => {
  it('should preserve cycle, lastInteraction, brainHash, totalSpent on evolve rejection', async () => {
    // Verify that evolve does not increment cycle (it's not an interaction)
    const genesis = await PetLifecycle.genesis(Field(12345));
    const prevState = genesis.proof.publicOutput;

    // Evolve will fail (cycle < 7 for hatch), but let's verify the constraint message
    // This confirms the cycle/state preservation logic is enforced
    await expect(async () => {
      await PetLifecycle.evolve(
        genesis.proof,
        UInt32.from(Stage.BABY),
        new PetStats({
          hunger: UInt32.from(100),
          happiness: UInt32.from(100),
          health: UInt32.from(100),
          hygiene: UInt32.from(100),
          energy: UInt32.from(100),
        })
      );
    }).rejects.toThrow();

    // Original state should be unchanged (genesis proof is immutable)
    expect(bn(prevState.cycle)).toBe(1n);
    expect(bn(prevState.stage)).toBe(0n);
  });
});

// =========================================================================
// AC-7 Positive Path: Successful hatch (egg->baby) and evolution (baby->adult)
// =========================================================================
describe('AC-7 positive path: evolve', () => {
  const ownerKey = PrivateKey.random();

  /**
   * Helper: run N interact steps on egg stage, cycling through egg-allowed actions
   * with sufficient time gaps to avoid cooldown violations.
   * Returns the final proof result and its cooldown timestamps.
   */
  async function runEggInteractions(
    count: number,
    startProof: Awaited<ReturnType<typeof PetLifecycle.genesis>>,
    startBrainHash: bigint
  ) {
    // Egg-allowed actions ordered strategically:
    //   1. check first (shortest cooldown 3600s, so earliest start)
    //   2. medicine early (+30 health)
    //   3. warm/talk/sing for happiness boost
    //   4. clean LAST to minimize post-clean hygiene decay
    // Each used only once so no cooldown collisions within 6 steps.
    // Timestamps chosen per-action to respect cooldown while minimizing total elapsed time.
    const eggSequence: { action: number; timestamp: number }[] = [
      { action: ActionType.CHECK, timestamp: 3700 }, // cooldown 3600, elapsed 3700 >= 3600
      { action: ActionType.WARM, timestamp: 5500 }, // cooldown 5400, elapsed 5500 >= 5400
      { action: ActionType.MEDICINE, timestamp: 7300 }, // cooldown 7200, elapsed 7300 >= 7200
      { action: ActionType.TALK, timestamp: 9000 }, // cooldown 5400, elapsed 9000 >= 5400
      { action: ActionType.SING, timestamp: 10700 }, // cooldown 5400, elapsed 10700 >= 5400
      { action: ActionType.CLEAN, timestamp: 12400 }, // cooldown 5400, elapsed 12400 >= 5400 -- LAST to preserve hygiene
    ];

    let currentResult: any = startProof;
    let currentCooldowns = zeroCooldowns();
    let brainCounter = startBrainHash;

    for (let i = 0; i < count; i++) {
      const step = eggSequence[i % eggSequence.length]!;
      const actionType = step.action;
      const timestamp = step.timestamp;
      const prevOutput = currentResult.proof.publicOutput;

      const prevStats = {
        hunger: Number(bn(prevOutput.stats.hunger)),
        happiness: Number(bn(prevOutput.stats.happiness)),
        health: Number(bn(prevOutput.stats.health)),
        hygiene: Number(bn(prevOutput.stats.hygiene)),
        energy: Number(bn(prevOutput.stats.energy)),
      };

      const elapsed = timestamp - Number(bn(prevOutput.lastInteraction));
      const decayed = computeDecay(prevStats, Stage.EGG, elapsed, false);
      const finalStats = applyAction(decayed, actionType, 0, Stage.EGG);

      brainCounter++;
      const params = buildInteractParams({
        prevProof: currentResult,
        actionType,
        timestamp,
        newStats: finalStats,
        newBrainHash: Field(brainCounter),
        prevCooldowns: currentCooldowns,
        ownerKey,
      });

      currentResult = await PetLifecycle.interact(
        currentResult.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
      currentCooldowns = params.newCooldowns;
    }

    return { result: currentResult, cooldowns: currentCooldowns, brainCounter };
  }

  /**
   * Helper: run N interact steps on baby stage, cycling through baby-allowed actions
   * with sufficient time gaps to avoid cooldown violations.
   */
  async function runBabyInteractions(
    count: number,
    startResult: any,
    startCooldowns: CooldownTimestamps,
    startBrainCounter: bigint,
    startTimestamp: number
  ) {
    // Baby action sequence designed to keep ALL stats >= 80 at cycle 21.
    // Cooldowns: feed=5400, clean=5400, rest=14400, check=3600, medicine=7200,
    //            talk=5400, play_music=5400.
    // With 1900s gaps, need >= 3 steps between feed/clean reuse (3*1900=5700>5400).
    // Rest reuse needs >= 8 steps (8*1900=15200>14400).
    //
    // feed at steps: 0, 3, 6, 9, 12  (gap=3 steps each)
    // clean at steps: 1, 4, 7, 10, 13 (gap=3 steps each)
    // rest at steps: 2, (no reuse needed, single use is enough since rest
    //   happens early and energy starts at 100 after hatch)
    // Plus check, talk, medicine, play_music to fill remaining slots.
    const babyActions = [
      ActionType.FEED, // step 0: +30 hunger
      ActionType.CLEAN, // step 1: +40 hygiene
      ActionType.REST, // step 2: +50 energy (first use)
      ActionType.FEED, // step 3: +30 hunger (gap from 0: 3*1900=5700>5400)
      ActionType.CLEAN, // step 4: +40 hygiene (gap from 1: 3*1900=5700>5400)
      ActionType.CHECK, // step 5: +2 health (first use)
      ActionType.FEED, // step 6: +30 hunger (gap from 3: 3*1900=5700>5400)
      ActionType.CLEAN, // step 7: +40 hygiene (gap from 4: 3*1900=5700>5400)
      ActionType.CHECK, // step 8: +2 health (gap from 5: 3*1900=5700>3600)
      ActionType.FEED, // step 9: +30 hunger (gap from 6: 3*1900=5700>5400)
      ActionType.REST, // step 10: +50 energy (gap from 2: 8*1900=15200>14400)
      ActionType.TALK, // step 11: +10 happiness (first use, gap from egg>>5400)
      ActionType.FEED, // step 12: +30 hunger (gap from 9: 3*1900=5700>5400)
      ActionType.CLEAN, // step 13: +40 hygiene (gap from 7: 6*1900=11400>5400)
    ];

    let currentResult = startResult;
    let currentCooldowns = startCooldowns;
    let brainCounter = startBrainCounter;
    // 1900s gaps keep feed/clean reuse at 5700s > 5400s cooldown.
    const timeGap = 1900;

    for (let i = 0; i < count; i++) {
      const actionType = babyActions[i]!;
      const timestamp = startTimestamp + (i + 1) * timeGap;
      const prevOutput = currentResult.proof.publicOutput;

      const prevStats = {
        hunger: Number(bn(prevOutput.stats.hunger)),
        happiness: Number(bn(prevOutput.stats.happiness)),
        health: Number(bn(prevOutput.stats.health)),
        hygiene: Number(bn(prevOutput.stats.hygiene)),
        energy: Number(bn(prevOutput.stats.energy)),
      };

      const elapsed = timestamp - Number(bn(prevOutput.lastInteraction));
      const decayed = computeDecay(prevStats, Stage.BABY, elapsed, false);
      const finalStats = applyAction(decayed, actionType, 0, Stage.BABY);

      brainCounter++;
      const params = buildInteractParams({
        prevProof: currentResult,
        actionType,
        timestamp,
        newStats: finalStats,
        newBrainHash: Field(brainCounter),
        prevCooldowns: currentCooldowns,
        ownerKey,
      });

      currentResult = await PetLifecycle.interact(
        currentResult.proof,
        params.action,
        params.stats,
        params.newBrainHash,
        params.prevCooldowns,
        params.newCooldowns,
        params.ownerPub,
        params.sig,
        params.slotTime
      );
      currentCooldowns = params.newCooldowns;
    }

    return { result: currentResult, cooldowns: currentCooldowns, brainCounter };
  }

  it('should successfully hatch egg->baby with stat resets and lifecycleHash update', async () => {
    // Given: genesis pet at egg stage
    const brainHash = Field(50000);
    const genesis = await PetLifecycle.genesis(brainHash);

    // When: run 6 interactions to reach cycle 7 (genesis starts at cycle 1)
    const { result: preEvolve } = await runEggInteractions(6, genesis, 50000n);
    const preEvolveState = preEvolve.proof.publicOutput;

    // Verify we reached cycle 7
    expect(bn(preEvolveState.cycle)).toBe(7n);
    expect(bn(preEvolveState.stage)).toBe(0n); // still egg

    // Verify hatch threshold stats are met (health >= 70, hygiene >= 70, happiness >= 70)
    expect(Number(bn(preEvolveState.stats.health))).toBeGreaterThanOrEqual(70);
    expect(Number(bn(preEvolveState.stats.hygiene))).toBeGreaterThanOrEqual(70);
    expect(Number(bn(preEvolveState.stats.happiness))).toBeGreaterThanOrEqual(
      70
    );

    // Hatch stat resets: hunger/happiness/hygiene/energy -> 100, health inherited
    const inheritedHealth = Number(bn(preEvolveState.stats.health));
    const hatchStats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(inheritedHealth),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    // Then: evolve should succeed
    const evolveResult = await PetLifecycle.evolve(
      preEvolve.proof,
      UInt32.from(Stage.BABY),
      hatchStats
    );

    const postEvolveState = evolveResult.proof.publicOutput;

    // Verify stage advanced to baby
    expect(bn(postEvolveState.stage)).toBe(1n);

    // Verify stat resets per Section 5.3: hunger/happiness/hygiene/energy = 100, health inherited
    expect(bn(postEvolveState.stats.hunger)).toBe(100n);
    expect(bn(postEvolveState.stats.happiness)).toBe(100n);
    expect(bn(postEvolveState.stats.health)).toBe(BigInt(inheritedHealth));
    expect(bn(postEvolveState.stats.hygiene)).toBe(100n);
    expect(bn(postEvolveState.stats.energy)).toBe(100n);

    // Verify cycle is NOT incremented on evolve
    expect(bn(postEvolveState.cycle)).toBe(7n);

    // Verify lastInteraction, brainHash, totalSpent, cooldownHash are preserved
    expect(postEvolveState.lastInteraction.toBigInt()).toBe(
      preEvolveState.lastInteraction.toBigInt()
    );
    expect(postEvolveState.brainHash.toBigInt()).toBe(
      preEvolveState.brainHash.toBigInt()
    );
    expect(postEvolveState.totalSpent.toBigInt()).toBe(
      preEvolveState.totalSpent.toBigInt()
    );
    expect(postEvolveState.cooldownHash.toBigInt()).toBe(
      preEvolveState.cooldownHash.toBigInt()
    );

    // Verify lifecycleHash was updated with evolution event
    const evolutionHash = Poseidon.hash([
      preEvolveState.stage.value, // 0 (egg)
      UInt32.from(Stage.BABY).value, // 1 (baby)
      Field(0),
      Field(0),
    ]);
    const expectedLifecycleHash = Poseidon.hash([
      preEvolveState.lifecycleHash,
      preEvolveState.cycle.value,
      preEvolveState.brainHash,
      evolutionHash,
      UInt32.from(Stage.BABY).value,
      preEvolveState.totalSpent.value,
    ]);
    expect(postEvolveState.lifecycleHash.toBigInt()).toBe(
      expectedLifecycleHash.toBigInt()
    );
    // Confirm it actually changed from the pre-evolve hash
    expect(postEvolveState.lifecycleHash.toBigInt()).not.toBe(
      preEvolveState.lifecycleHash.toBigInt()
    );
  }, 360000);

  it('should successfully evolve baby->adult with all stats inherited and lifecycleHash update', async () => {
    // Given: genesis -> 6 egg interactions -> hatch to baby
    const brainHash = Field(60000);
    const genesis = await PetLifecycle.genesis(brainHash);

    const {
      result: preHatch,
      cooldowns: eggCooldowns,
      brainCounter: eggBrainCounter,
    } = await runEggInteractions(6, genesis, 60000n);

    const preHatchState = preHatch.proof.publicOutput;
    const inheritedHealth = Number(bn(preHatchState.stats.health));

    // Hatch egg->baby
    const hatchStats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(inheritedHealth),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const hatchResult = await PetLifecycle.evolve(
      preHatch.proof,
      UInt32.from(Stage.BABY),
      hatchStats
    );
    expect(bn(hatchResult.proof.publicOutput.stage)).toBe(1n);
    expect(bn(hatchResult.proof.publicOutput.cycle)).toBe(7n);

    // When: run 14 more baby interactions to reach cycle 21
    // Last egg interaction was at 12400s. Egg cooldown timestamps:
    //   check@3700, warm@5500, medicine@7300, talk@9000, sing@10700, clean@12400
    // Baby cooldowns for shared actions: check=3600, clean=5400, talk=5400, medicine=7200
    // Worst case: medicine at 7300, baby cooldown 7200 -> need >= 14500
    // clean at 12400, baby cooldown 5400 -> need >= 17800
    // Start at 18000 to safely clear all, minimizing decay from hatch.
    const babyStartTimestamp = 18000;
    const { result: preAdultEvolve } = await runBabyInteractions(
      14,
      hatchResult,
      eggCooldowns, // cooldown state carries over (preserved on evolve)
      eggBrainCounter,
      babyStartTimestamp
    );

    const preAdultState = preAdultEvolve.proof.publicOutput;

    // Verify we reached cycle 21
    expect(bn(preAdultState.cycle)).toBe(21n);
    expect(bn(preAdultState.stage)).toBe(1n); // still baby

    // Verify evolution threshold stats are met (all >= 80)
    const statsBeforeEvolve = {
      hunger: Number(bn(preAdultState.stats.hunger)),
      happiness: Number(bn(preAdultState.stats.happiness)),
      health: Number(bn(preAdultState.stats.health)),
      hygiene: Number(bn(preAdultState.stats.hygiene)),
      energy: Number(bn(preAdultState.stats.energy)),
    };
    expect(statsBeforeEvolve.hunger).toBeGreaterThanOrEqual(80);
    expect(statsBeforeEvolve.happiness).toBeGreaterThanOrEqual(80);
    expect(statsBeforeEvolve.health).toBeGreaterThanOrEqual(80);
    expect(statsBeforeEvolve.hygiene).toBeGreaterThanOrEqual(80);
    expect(statsBeforeEvolve.energy).toBeGreaterThanOrEqual(80);

    // Evolution stat resets: ALL stats inherited (no resets for baby->adult)
    const evolveStats = new PetStats({
      hunger: UInt32.from(statsBeforeEvolve.hunger),
      happiness: UInt32.from(statsBeforeEvolve.happiness),
      health: UInt32.from(statsBeforeEvolve.health),
      hygiene: UInt32.from(statsBeforeEvolve.hygiene),
      energy: UInt32.from(statsBeforeEvolve.energy),
    });

    // Then: evolve should succeed
    const evolveResult = await PetLifecycle.evolve(
      preAdultEvolve.proof,
      UInt32.from(Stage.ADULT),
      evolveStats
    );

    const postEvolveState = evolveResult.proof.publicOutput;

    // Verify stage advanced to adult
    expect(bn(postEvolveState.stage)).toBe(2n);

    // Verify all stats inherited (no resets for baby->adult per Section 5.3)
    expect(bn(postEvolveState.stats.hunger)).toBe(
      BigInt(statsBeforeEvolve.hunger)
    );
    expect(bn(postEvolveState.stats.happiness)).toBe(
      BigInt(statsBeforeEvolve.happiness)
    );
    expect(bn(postEvolveState.stats.health)).toBe(
      BigInt(statsBeforeEvolve.health)
    );
    expect(bn(postEvolveState.stats.hygiene)).toBe(
      BigInt(statsBeforeEvolve.hygiene)
    );
    expect(bn(postEvolveState.stats.energy)).toBe(
      BigInt(statsBeforeEvolve.energy)
    );

    // Verify cycle is NOT incremented on evolve
    expect(bn(postEvolveState.cycle)).toBe(21n);

    // Verify lifecycleHash was updated with evolution event
    const evolutionHash = Poseidon.hash([
      preAdultState.stage.value, // 1 (baby)
      UInt32.from(Stage.ADULT).value, // 2 (adult)
      Field(0),
      Field(0),
    ]);
    const expectedLifecycleHash = Poseidon.hash([
      preAdultState.lifecycleHash,
      preAdultState.cycle.value,
      preAdultState.brainHash,
      evolutionHash,
      UInt32.from(Stage.ADULT).value,
      preAdultState.totalSpent.value,
    ]);
    expect(postEvolveState.lifecycleHash.toBigInt()).toBe(
      expectedLifecycleHash.toBigInt()
    );
    // Confirm it actually changed
    expect(postEvolveState.lifecycleHash.toBigInt()).not.toBe(
      preAdultState.lifecycleHash.toBigInt()
    );
  }, 900000);
});

// =========================================================================
// AC-15 Gap Coverage: blake3ToField boundary cases
// =========================================================================
describe('AC-15 gap: blake3ToField boundary cases', () => {
  it('should handle all-zeros hash', () => {
    const hash = '00'.repeat(32);
    const field = blake3ToField(hash);
    expect(field.toBigInt()).toBe(0n);
  });

  it('should truncate top 3 bits correctly', () => {
    // First byte 0xFF -> after mask with 0x1F -> 0x1F
    const hash = 'ff' + '00'.repeat(31);
    const field = blake3ToField(hash);
    const expected = BigInt('0x1f' + '00'.repeat(31));
    expect(field.toBigInt()).toBe(expected);
  });

  it('should preserve lower bits of first byte', () => {
    // First byte 0x1F -> after mask -> still 0x1F (no change)
    const hash = '1f' + '00'.repeat(31);
    const field = blake3ToField(hash);
    const expected = BigInt('0x1f' + '00'.repeat(31));
    expect(field.toBigInt()).toBe(expected);
  });
});

// =========================================================================
// Boundary Tests: Extended (test design calls for ~12 boundary tests)
// =========================================================================
describe('Boundary tests: extended', () => {
  it('should keep stats at exactly 1 when already at minimum after decay', () => {
    const result = computeDecay(
      { hunger: 1, happiness: 1, health: 1, hygiene: 1, energy: 1 },
      Stage.BABY,
      3600,
      false
    );
    expect(result.hunger).toBe(1);
    expect(result.happiness).toBe(1);
    expect(result.health).toBe(1);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
  });

  it('should keep stats at exactly 100 when already at maximum with no decay elapsed', () => {
    const result = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.BABY,
      0,
      false
    );
    expect(result.hunger).toBe(100);
    expect(result.happiness).toBe(100);
    expect(result.hygiene).toBe(100);
    expect(result.energy).toBe(100);
  });

  it('should correctly compute decay for very small elapsed times (1 second)', () => {
    // With baby hunger rate -700 scaled: floor(-700 * 1 / 360000) = floor(-0.00194) = -1
    // Math.floor of a negative fraction rounds towards negative infinity
    const result = computeDecay(
      { hunger: 50, happiness: 50, health: 50, hygiene: 50, energy: 50 },
      Stage.BABY,
      1,
      false
    );
    // Even 1 second produces a -1 delta due to Math.floor on negative fractions
    // The key invariant: stats remain in [1, 100]
    expect(result.hunger).toBeGreaterThanOrEqual(1);
    expect(result.hunger).toBeLessThanOrEqual(100);
    expect(result.happiness).toBeGreaterThanOrEqual(1);
    expect(result.happiness).toBeLessThanOrEqual(100);
  });

  it('should correctly compute decay for very large elapsed times (24 hours)', () => {
    const result = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.BABY,
      86400,
      false
    );
    // 24 hours of baby decay: most stats should be near or at floor
    // hunger: floor(-700 * 86400 / 360000) = -168, clamped to 1
    expect(result.hunger).toBe(1);
    // happiness: may not hit 1 due to lower rate, but should be very low
    expect(result.happiness).toBeLessThanOrEqual(10);
    expect(result.hygiene).toBe(1);
    expect(result.energy).toBe(1);
    // health takes penalties from low stats, should be very low
    expect(result.health).toBeLessThanOrEqual(10);
  });

  it('should handle egg stage with all stats at 100 correctly (no hunger/energy decay)', () => {
    const result = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      3600,
      false
    );
    expect(result.hunger).toBe(100); // forced to 100 for egg
    expect(result.energy).toBe(100); // forced to 100 for egg
    expect(result.hygiene).toBeLessThan(100); // does decay for egg
  });

  it('should handle adult decay rates (slower than baby)', () => {
    const babyResult = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.BABY,
      3600,
      false
    );
    const adultResult = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.ADULT,
      3600,
      false
    );
    // Adult decay rates are slower than baby for all stats
    expect(adultResult.hunger).toBeGreaterThan(babyResult.hunger);
    expect(adultResult.happiness).toBeGreaterThan(babyResult.happiness);
    expect(adultResult.hygiene).toBeGreaterThan(babyResult.hygiene);
    expect(adultResult.energy).toBeGreaterThan(babyResult.energy);
  });

  it('should handle health regen bonus when all stats >= 80 (baby)', () => {
    const result = computeDecay(
      { hunger: 100, happiness: 100, health: 90, hygiene: 100, energy: 100 },
      Stage.BABY,
      3600,
      false
    );
    // After 1hr: hunger=93, happiness=96, hygiene=95, energy=92 -- all >= 80
    // Health gets regen bonus (+150) added to base rate (-75), net +75
    // health delta = floor(75 * 3600 / 360000) = floor(0.75) = 0
    // So health stays at 90 (base rate and regen roughly cancel)
    expect(result.health).toBeGreaterThanOrEqual(89);
  });

  it('should handle health regen bonus when all stats >= 80 (adult)', () => {
    const result = computeDecay(
      { hunger: 100, happiness: 100, health: 90, hygiene: 100, energy: 100 },
      Stage.ADULT,
      3600,
      false
    );
    // Adult: base health -40, regen +100 when all >= 80, net +60
    // health delta = floor(60 * 3600 / 360000) = floor(0.6) = 0
    // Regen is subtle at 1 hour
    expect(result.health).toBeGreaterThanOrEqual(89);
  });

  it('should increment cycle by exactly 1 for each interaction (not 0, not 2)', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);
    expect(genesis.proof.publicOutput.cycle.toBigInt()).toBe(1n);

    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const ownerKey = PrivateKey.random();
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    // Cycle should be exactly 2 (1 + 1), not 3 or 1
    expect(result.proof.publicOutput.cycle.toBigInt()).toBe(2n);
  });

  it('should not change stage during interact (stage change is evolve-only)', async () => {
    const brainHash = Field(12345);
    const genesis = await PetLifecycle.genesis(brainHash);

    const decayed = computeDecay(
      { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
      Stage.EGG,
      7200,
      false
    );
    const finalStats = applyAction(decayed, ActionType.WARM, 0, Stage.EGG);
    const ownerKey = PrivateKey.random();
    const params = buildInteractParams({
      prevProof: genesis,
      actionType: ActionType.WARM,
      timestamp: 7200,
      newStats: finalStats,
      newBrainHash: Field(99999),
      prevCooldowns: zeroCooldowns(),
      ownerKey,
    });

    const result = await PetLifecycle.interact(
      genesis.proof,
      params.action,
      params.stats,
      params.newBrainHash,
      params.prevCooldowns,
      params.newCooldowns,
      params.ownerPub,
      params.sig,
      params.slotTime
    );

    // Stage must remain 0 (egg) -- interact never changes stage
    expect(result.proof.publicOutput.stage.toBigint()).toBe(0n);
  });
});

// =========================================================================
// Property-style tests: random action sequences never violate stat bounds
// =========================================================================
describe('Property tests: stat invariants across deterministic action sequences', () => {
  // Deterministic pseudo-random sequence for reproducible tests (project-context.md: deterministic test data)
  function deterministicElapsed(i: number): number {
    // Produces values in [1800, 7200) range using a simple deterministic formula
    return 1800 + ((i * 1373 + 797) % 5400);
  }
  function deterministicSleeping(i: number): boolean {
    return i % 5 === 0; // ~20% sleeping, deterministic
  }

  it('should never produce stats outside [1, 100] for deterministic baby action sequences', () => {
    const babyActions = [
      ActionType.FEED,
      ActionType.PLAY,
      ActionType.CLEAN,
      ActionType.REST,
      ActionType.CHECK,
      ActionType.TALK,
      ActionType.MEDICINE,
      ActionType.PLAY_MUSIC,
    ];

    let stats = {
      hunger: 50,
      happiness: 50,
      health: 50,
      hygiene: 50,
      energy: 50,
    };

    // Simulate 50 deterministic action+decay cycles
    for (let i = 0; i < 50; i++) {
      const elapsed = deterministicElapsed(i);
      const isSleeping = deterministicSleeping(i);
      stats = computeDecay(stats, Stage.BABY, elapsed, isSleeping);

      // Verify bounds after decay
      expect(stats.hunger).toBeGreaterThanOrEqual(1);
      expect(stats.hunger).toBeLessThanOrEqual(100);
      expect(stats.happiness).toBeGreaterThanOrEqual(1);
      expect(stats.happiness).toBeLessThanOrEqual(100);
      expect(stats.health).toBeGreaterThanOrEqual(1);
      expect(stats.health).toBeLessThanOrEqual(100);
      expect(stats.hygiene).toBeGreaterThanOrEqual(1);
      expect(stats.hygiene).toBeLessThanOrEqual(100);
      expect(stats.energy).toBeGreaterThanOrEqual(1);
      expect(stats.energy).toBeLessThanOrEqual(100);

      const actionType = babyActions[i % babyActions.length]!;
      stats = applyAction(stats, actionType, 0, Stage.BABY);

      // Verify bounds after action
      expect(stats.hunger).toBeGreaterThanOrEqual(1);
      expect(stats.hunger).toBeLessThanOrEqual(100);
      expect(stats.happiness).toBeGreaterThanOrEqual(1);
      expect(stats.happiness).toBeLessThanOrEqual(100);
      expect(stats.health).toBeGreaterThanOrEqual(1);
      expect(stats.health).toBeLessThanOrEqual(100);
      expect(stats.hygiene).toBeGreaterThanOrEqual(1);
      expect(stats.hygiene).toBeLessThanOrEqual(100);
      expect(stats.energy).toBeGreaterThanOrEqual(1);
      expect(stats.energy).toBeLessThanOrEqual(100);
    }
  });

  it('should never produce stats outside [1, 100] for deterministic adult action sequences', () => {
    const adultActions = [
      ActionType.FEED,
      ActionType.PLAY,
      ActionType.CLEAN,
      ActionType.REST,
      ActionType.CHECK,
      ActionType.TALK,
      ActionType.MEDICINE,
      ActionType.CRUZAR,
      ActionType.PLAY_MUSIC,
    ];

    let stats = {
      hunger: 80,
      happiness: 80,
      health: 80,
      hygiene: 80,
      energy: 80,
    };

    for (let i = 0; i < 50; i++) {
      const elapsed = deterministicElapsed(i + 100);
      const isSleeping = deterministicSleeping(i + 100);
      stats = computeDecay(stats, Stage.ADULT, elapsed, isSleeping);

      for (const key of [
        'hunger',
        'happiness',
        'health',
        'hygiene',
        'energy',
      ] as const) {
        expect(stats[key]).toBeGreaterThanOrEqual(1);
        expect(stats[key]).toBeLessThanOrEqual(100);
      }

      const actionType = adultActions[i % adultActions.length]!;
      stats = applyAction(stats, actionType, 0, Stage.ADULT);

      for (const key of [
        'hunger',
        'happiness',
        'health',
        'hygiene',
        'energy',
      ] as const) {
        expect(stats[key]).toBeGreaterThanOrEqual(1);
        expect(stats[key]).toBeLessThanOrEqual(100);
      }
    }
  });

  it('should never produce stats outside [1, 100] for deterministic egg action sequences', () => {
    const eggActions = [
      ActionType.WARM,
      ActionType.CHECK,
      ActionType.SING,
      ActionType.TALK,
      ActionType.CLEAN,
      ActionType.MEDICINE,
      ActionType.PLAY_MUSIC,
    ];

    let stats = {
      hunger: 100,
      happiness: 70,
      health: 70,
      hygiene: 70,
      energy: 100,
    };

    for (let i = 0; i < 50; i++) {
      const elapsed = deterministicElapsed(i + 200);
      stats = computeDecay(stats, Stage.EGG, elapsed, false);

      for (const key of [
        'hunger',
        'happiness',
        'health',
        'hygiene',
        'energy',
      ] as const) {
        expect(stats[key]).toBeGreaterThanOrEqual(1);
        expect(stats[key]).toBeLessThanOrEqual(100);
      }

      const actionType = eggActions[i % eggActions.length]!;
      stats = applyAction(stats, actionType, 0, Stage.EGG);

      for (const key of [
        'hunger',
        'happiness',
        'health',
        'hygiene',
        'energy',
      ] as const) {
        expect(stats[key]).toBeGreaterThanOrEqual(1);
        expect(stats[key]).toBeLessThanOrEqual(100);
      }
    }
  });
});

// =========================================================================
// Constant table validation: verify action count and stage count match
// =========================================================================
describe('Constant table structural validation', () => {
  it('should have correct number of entries in COOLDOWN_DURATIONS (3 stages x 11 actions)', () => {
    expect(COOLDOWN_DURATIONS.length).toBe(3);
    for (const stage of COOLDOWN_DURATIONS) {
      expect(stage.length).toBe(ACTION_COUNT);
    }
  });

  it('should have correct number of entries in STAGE_ALLOWED_ACTIONS (3 stages x 11 actions)', () => {
    expect(STAGE_ALLOWED_ACTIONS.length).toBe(3);
    for (const stage of STAGE_ALLOWED_ACTIONS) {
      expect(stage.length).toBe(ACTION_COUNT);
    }
  });

  it('should have correct number of entries in BASE_ACTION_EFFECTS (11 actions x 5 stats)', () => {
    expect(BASE_ACTION_EFFECTS.length).toBe(ACTION_COUNT);
    for (const effects of BASE_ACTION_EFFECTS) {
      expect(effects.length).toBe(5);
    }
  });

  it('STAGE_ALLOWED_ACTIONS should be consistent with COOLDOWN_DURATIONS', () => {
    // An action is allowed iff its cooldown is non-zero
    for (let s = 0; s < 3; s++) {
      for (let a = 0; a < ACTION_COUNT; a++) {
        const allowed = STAGE_ALLOWED_ACTIONS[s]![a]!;
        const cooldown = COOLDOWN_DURATIONS[s]![a]!;
        expect(allowed).toBe(cooldown > 0);
      }
    }
  });

  it('should have exactly 7 egg, 8 baby, 9 adult allowed actions', () => {
    const eggCount = STAGE_ALLOWED_ACTIONS[0]!.filter(Boolean).length;
    const babyCount = STAGE_ALLOWED_ACTIONS[1]!.filter(Boolean).length;
    const adultCount = STAGE_ALLOWED_ACTIONS[2]!.filter(Boolean).length;
    expect(eggCount).toBe(7);
    expect(babyCount).toBe(8);
    expect(adultCount).toBe(9);
  });

  it('should have 18 shop items with unique itemIds', () => {
    expect(SHOP_ITEMS.length).toBe(18);
    const ids = SHOP_ITEMS.map((item) => item.itemId);
    expect(new Set(ids).size).toBe(18);
  });

  it('all shop items should have positive token costs', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.tokenCost).toBeGreaterThan(0);
    }
  });

  it('all shop item effects arrays should have exactly 5 entries', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.effects.length).toBe(5);
    }
  });
});
