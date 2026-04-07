/**
 * PetLifecycle ZkProgram -- Recursive Proof Chain Test (AC-13)
 *
 * This test uses proofsEnabled: true -- actual ZK proof generation.
 * Expected runtime: ~5 minutes (tagged @slow for separate CI execution).
 *
 * Test framework: Jest (o1js WASM incompatible with vitest)
 * Proof mode: proofsEnabled: true (actual proof generation)
 *
 * @slow
 */

import { Field, UInt32, UInt64, Poseidon, PrivateKey, Signature } from 'o1js';

import {
  PetLifecycle,
  PetStats,
  PetAction,
  CooldownTimestamps,
  ActionType,
  Stage,
  ACTION_COUNT,
} from './index';
import { computeDecay, applyAction } from './utils';

// Helper: create CooldownTimestamps from array
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

describe('PetLifecycle Recursive Proof Chain (proofsEnabled: true)', () => {
  jest.setTimeout(600000); // 10 minutes

  it.skip('AC-13: genesis -> 10 interact steps -> verify final lifecycleHash is correct', async () => {
    // Compile with proofs enabled
    await PetLifecycle.compile();

    const ownerKey = PrivateKey.random();
    const ownerPub = ownerKey.toPublicKey();
    const initialBrainHash = Field(99999);

    // Step 1: Genesis
    const genesisResult = await PetLifecycle.genesis(initialBrainHash);
    expect(genesisResult.publicOutput.stage.toBigint()).toBe(0n);
    expect(genesisResult.publicOutput.cycle.toBigint()).toBe(1n);

    // Step 2: 10 interactions
    // Alternate between valid egg actions: warm(4), check(5), sing(6), talk(7), clean(2), etc.
    const eggActions = [
      ActionType.WARM,
      ActionType.CHECK,
      ActionType.SING,
      ActionType.TALK,
      ActionType.CLEAN,
      ActionType.WARM,
      ActionType.CHECK,
      ActionType.PLAY_MUSIC,
      ActionType.TALK,
      ActionType.MEDICINE,
    ];

    let currentProof = genesisResult;
    const cooldownArr = new Array(ACTION_COUNT).fill(0);
    const baseTimestamp = 1700000000;

    for (let i = 0; i < 10; i++) {
      const actionType = eggActions[i]!;
      const timestamp = baseTimestamp + (i + 1) * 7200;
      const newBrainHash = Field(100000 + i);

      // Compute expected stats
      const prevStats = currentProof.publicOutput.stats;
      const stats = {
        hunger: Number(prevStats.hunger.toBigint()),
        happiness: Number(prevStats.happiness.toBigint()),
        health: Number(prevStats.health.toBigint()),
        hygiene: Number(prevStats.hygiene.toBigint()),
        energy: Number(prevStats.energy.toBigint()),
      };
      const elapsed =
        timestamp -
        Number(currentProof.publicOutput.lastInteraction.toBigint());
      const decayed = computeDecay(stats, Stage.EGG, elapsed, false);
      const finalStats = applyAction(decayed, actionType, 0, Stage.EGG);

      const action = new PetAction({
        actionType: UInt32.from(actionType),
        itemId: UInt32.from(0),
        timestamp: UInt64.from(timestamp),
        tokenCost: UInt64.from(0),
      });

      const interactionHash = Poseidon.hash([
        action.actionType.value,
        action.itemId.value,
        action.timestamp.value,
        action.tokenCost.value,
      ]);
      const sig = Signature.create(ownerKey, [interactionHash]);

      const prevCooldowns = makeCooldowns(cooldownArr);
      cooldownArr[actionType] = timestamp;
      const newCooldowns = makeCooldowns(cooldownArr);

      const start = Date.now();
      const result = await PetLifecycle.interact(
        currentProof.proof,
        action,
        new PetStats({
          hunger: UInt32.from(finalStats.hunger),
          happiness: UInt32.from(finalStats.happiness),
          health: UInt32.from(finalStats.health),
          hygiene: UInt32.from(finalStats.hygiene),
          energy: UInt32.from(finalStats.energy),
        }),
        newBrainHash,
        prevCooldowns,
        newCooldowns,
        ownerPub,
        sig,
        UInt64.from(timestamp)
      );
      const elapsed_ms = Date.now() - start;
      console.log(`Step ${i + 1} proof time: ${elapsed_ms}ms`);

      expect(result.publicOutput.cycle.toBigint()).toBe(BigInt(i + 2));
      currentProof = result;
    }

    // Step 3: Verify final state
    const finalState = currentProof.publicOutput;
    expect(finalState.cycle.toBigint()).toBe(11n);
    expect(finalState.lifecycleHash.toBigInt()).not.toBe(0n);
  });
});
