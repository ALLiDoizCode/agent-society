/* eslint-disable @typescript-eslint/no-non-null-assertion -- bounds-checked constant array lookups in test helpers */
/**
 * PetZkApp SmartContract Unit Tests (GREEN Phase)
 *
 * Tests PetZkApp on LocalBlockchain with proofsEnabled: false.
 * Sequential test structure: deploy once, then test init -> applyProof ->
 * transferOperator -> applyProof with new operator.
 *
 * Story 11.3 -- AC-7
 */

import {
  Mina,
  PrivateKey,
  type PublicKey,
  Field,
  AccountUpdate,
  Signature,
  Poseidon,
  UInt32,
  UInt64,
} from 'o1js';

import { PetZkApp } from './PetZkApp';
import { PetLifecycle, CooldownTimestamps } from './PetLifecycle';
import type { PetLifecycleProof } from './PetLifecycle';
import { PetStats, PetAction } from './structs';
import { ActionType, ACTION_COUNT } from './constants';

describe('PetZkApp SmartContract (Unit Tests -- proofsEnabled: false)', () => {
  let deployer: Mina.TestPublicKey;
  let zkAppKey: PrivateKey;
  let zkAppAddress: PublicKey;
  let zkApp: PetZkApp;
  let ownerKey: PrivateKey;
  let ownerPubkey: PublicKey;
  let operatorKey: PrivateKey;
  let operatorPubkey: PublicKey;

  // Test data
  const seed = Field(42);
  const blobbiId = Field(7);
  const brainHash = Field(12345);

  // Shared proof references for sequential tests
  let genesisProof: InstanceType<typeof PetLifecycleProof>;
  let interactProof: InstanceType<typeof PetLifecycleProof>;

  beforeAll(async () => {
    // o1js v2.14.0 requires compile() even with proofsEnabled: false
    // to set up the prover/dummy proof infrastructure
    await PetLifecycle.compile();
    await PetZkApp.compile();

    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);
    [deployer] = Local.testAccounts;

    zkAppKey = PrivateKey.random();
    zkAppAddress = zkAppKey.toPublicKey();
    zkApp = new PetZkApp(zkAppAddress);

    ownerKey = PrivateKey.random();
    ownerPubkey = ownerKey.toPublicKey();
    operatorKey = PrivateKey.random();
    operatorPubkey = operatorKey.toPublicKey();
  });

  // Helper: deploy PetZkApp
  async function deployZkApp() {
    const tx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await tx.prove();
    await tx.sign([deployer.key, zkAppKey]).send();
  }

  // Helper: build cooldown timestamps from an array of numbers
  function cooldownsFromArray(arr: number[]): CooldownTimestamps {
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

  // Helper: create an interact proof from a previous proof
  async function createInteractProof(
    prevProof: InstanceType<typeof PetLifecycleProof>,
    actionTypeIdx: number,
    timestamp: number,
    prevCooldownArr: number[],
    newBrain: Field
  ): Promise<{
    proof: InstanceType<typeof PetLifecycleProof>;
    cooldownArr: number[];
  }> {
    const action = new PetAction({
      actionType: UInt32.from(actionTypeIdx),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(timestamp),
      tokenCost: UInt64.from(0),
    });
    const stats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const prevCDs = cooldownsFromArray(prevCooldownArr);
    const newCooldownArr = [...prevCooldownArr];
    newCooldownArr[actionTypeIdx] = timestamp;
    const newCDs = prevCDs.setByIndex(
      UInt32.from(actionTypeIdx),
      UInt64.from(timestamp)
    );

    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerSig = Signature.create(ownerKey, [interactionHash]);

    const result = await PetLifecycle.interact(
      prevProof,
      action,
      stats,
      newBrain,
      prevCDs,
      newCDs,
      ownerPubkey,
      ownerSig,
      UInt64.from(timestamp)
    );
    return { proof: result.proof, cooldownArr: newCooldownArr };
  }

  // =========================================================================
  // AC-1: PetZkApp deploys with all 8 state fields at Field(0)
  // =========================================================================

  it('[P0] AC-1: should deploy PetZkApp with all 8 state fields initialized to Field(0)', async () => {
    await deployZkApp();

    expect(zkApp.petId.get()).toEqual(Field(0));
    expect(zkApp.brainHash.get()).toEqual(Field(0));
    expect(zkApp.lifecycleHash.get()).toEqual(Field(0));
    expect(zkApp.cycle.get()).toEqual(Field(0));
    expect(zkApp.stage.get()).toEqual(Field(0));
    expect(zkApp.ownerX.get()).toEqual(Field(0));
    expect(zkApp.operatorX.get()).toEqual(Field(0));
    expect(zkApp.totalSpent.get()).toEqual(Field(0));
  });

  // =========================================================================
  // AC-3: initializePet method
  // =========================================================================

  it('[P0] AC-3: should initialize pet with genesis proof and set all 8 on-chain fields', async () => {
    const genesisResult = await PetLifecycle.genesis(brainHash);
    genesisProof = genesisResult.proof;
    const genesisOutput = genesisProof.publicOutput;

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.initializePet(
        ownerPubkey,
        operatorPubkey,
        seed,
        blobbiId,
        genesisProof
      );
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    const expectedPetId = Poseidon.hash([ownerPubkey.x, seed, blobbiId]);

    expect(zkApp.petId.get()).toEqual(expectedPetId);
    expect(zkApp.brainHash.get()).toEqual(genesisOutput.brainHash);
    expect(zkApp.lifecycleHash.get()).toEqual(genesisOutput.lifecycleHash);
    expect(zkApp.cycle.get()).toEqual(genesisOutput.cycle.value);
    expect(zkApp.stage.get()).toEqual(genesisOutput.stage.value);
    expect(zkApp.ownerX.get()).toEqual(ownerPubkey.x);
    expect(zkApp.operatorX.get()).toEqual(operatorPubkey.x);
    expect(zkApp.totalSpent.get()).toEqual(genesisOutput.totalSpent.value);
  });

  // =========================================================================
  // AC-3: initializePet -- double-init rejection
  // =========================================================================

  it('[P0] AC-3: should reject double-initialization (all state fields non-zero)', async () => {
    // Pet is already initialized from the previous test.
    // Calling initializePet again should fail because state fields are no longer Field(0).
    const secondGenesis = await PetLifecycle.genesis(Field(77777));
    const secondGenesisProof = secondGenesis.proof;

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.initializePet(
          ownerPubkey,
          operatorPubkey,
          seed,
          blobbiId,
          secondGenesisProof
        );
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  it('[P0] AC-3: should reject double-initialization from a different owner', async () => {
    // A completely different owner tries to re-initialize the already-initialized pet.
    const attackerKey = PrivateKey.random();
    const attackerPubkey = attackerKey.toPublicKey();
    const attackerOperatorKey = PrivateKey.random();
    const attackerOperatorPubkey = attackerOperatorKey.toPublicKey();

    const attackerGenesis = await PetLifecycle.genesis(Field(55555));
    const attackerGenesisProof = attackerGenesis.proof;

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.initializePet(
          attackerPubkey,
          attackerOperatorPubkey,
          Field(999),
          Field(888),
          attackerGenesisProof
        );
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-4: applyProof -- valid case
  // =========================================================================

  it('[P0] AC-4: should apply a valid proof with correct operator and update mutable state', async () => {
    // Create interact proof: use CHECK action (actionType=5), allowed for egg stage
    const zeroCDs = Array(ACTION_COUNT).fill(0);
    const result = await createInteractProof(
      genesisProof,
      ActionType.CHECK, // 5
      10000,
      zeroCDs,
      Field(99999)
    );
    interactProof = result.proof;
    const proofOutput = interactProof.publicOutput;

    // Operator signs the new lifecycleHash
    const operatorSig = Signature.create(operatorKey, [
      proofOutput.lifecycleHash,
    ]);

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(interactProof, operatorPubkey, operatorSig);
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    // Mutable state fields should be updated
    expect(zkApp.brainHash.get()).toEqual(proofOutput.brainHash);
    expect(zkApp.lifecycleHash.get()).toEqual(proofOutput.lifecycleHash);
    expect(zkApp.cycle.get()).toEqual(proofOutput.cycle.value);
    expect(zkApp.stage.get()).toEqual(proofOutput.stage.value);
    expect(zkApp.totalSpent.get()).toEqual(proofOutput.totalSpent.value);

    // Immutable fields should NOT change
    const expectedPetId = Poseidon.hash([ownerPubkey.x, seed, blobbiId]);
    expect(zkApp.petId.get()).toEqual(expectedPetId);
    expect(zkApp.ownerX.get()).toEqual(ownerPubkey.x);
  });

  // =========================================================================
  // AC-4: applyProof -- invalid operator signature rejected
  // =========================================================================

  it('[P0] AC-4: should reject applyProof with invalid operator signature', async () => {
    const proofOutput = interactProof.publicOutput;
    const randomKey = PrivateKey.random();
    const invalidSig = Signature.create(randomKey, [proofOutput.lifecycleHash]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.applyProof(interactProof, operatorPubkey, invalidSig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-4: applyProof -- wrong operator pubkey rejected
  // =========================================================================

  it('[P0] AC-4: should reject applyProof with wrong operatorPubkey (x-coordinate mismatch)', async () => {
    const wrongOperatorKey = PrivateKey.random();
    const wrongOperatorPubkey = wrongOperatorKey.toPublicKey();
    const proofOutput = interactProof.publicOutput;
    const sig = Signature.create(wrongOperatorKey, [proofOutput.lifecycleHash]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.applyProof(interactProof, wrongOperatorPubkey, sig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-4: applyProof -- stale proof (cycle not advanced) rejected
  // =========================================================================

  it('[P0] AC-4: should reject applyProof with stale proof (cycle not advanced)', async () => {
    // The genesisProof has cycle=1 but on-chain cycle is already 2 after the
    // previous applyProof. Submitting genesis proof again should fail because
    // proof.publicOutput.cycle (1) is not > on-chain cycle (2).
    const staleSig = Signature.create(operatorKey, [
      genesisProof.publicOutput.lifecycleHash,
    ]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.applyProof(genesisProof, operatorPubkey, staleSig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-4: applyProof -- equal cycle (not advanced) rejected
  // =========================================================================

  it('[P0] AC-4: should reject applyProof when proof cycle equals on-chain cycle (not strictly greater)', async () => {
    // On-chain cycle is 2 after the previous successful applyProof.
    // interactProof also has cycle=2. Submitting it again should fail because
    // proof.publicOutput.cycle (2) is not > on-chain cycle (2).
    const equalCycleSig = Signature.create(operatorKey, [
      interactProof.publicOutput.lifecycleHash,
    ]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.applyProof(interactProof, operatorPubkey, equalCycleSig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-5: transferOperator -- valid case
  // =========================================================================

  let newOperatorKey: PrivateKey;
  let newOperatorPubkey: PublicKey;

  it('[P0] AC-5: should transfer operator with valid owner signature', async () => {
    newOperatorKey = PrivateKey.random();
    newOperatorPubkey = newOperatorKey.toPublicKey();

    const ownerSig = Signature.create(ownerKey, [newOperatorPubkey.x]);

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.transferOperator(newOperatorPubkey, ownerPubkey, ownerSig);
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    expect(zkApp.operatorX.get()).toEqual(newOperatorPubkey.x);
    expect(zkApp.ownerX.get()).toEqual(ownerPubkey.x);
  });

  // =========================================================================
  // AC-5: transferOperator -- wrong key rejected
  // =========================================================================

  it('[P0] AC-5: should reject transferOperator with wrong owner signature', async () => {
    const anotherNewOperator = PrivateKey.random().toPublicKey();
    const wrongKey = PrivateKey.random();
    const invalidOwnerSig = Signature.create(wrongKey, [anotherNewOperator.x]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.transferOperator(
          anotherNewOperator,
          ownerPubkey,
          invalidOwnerSig
        );
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-5: transferOperator -- wrong ownerPubkey (x-coordinate mismatch) rejected
  // =========================================================================

  it('[P0] AC-5: should reject transferOperator with wrong ownerPubkey (x-coordinate mismatch)', async () => {
    const anotherNewOperator = PrivateKey.random().toPublicKey();
    const wrongOwnerKey = PrivateKey.random();
    const wrongOwnerPubkey = wrongOwnerKey.toPublicKey();
    // Valid signature from wrong owner -- sig is correct for wrongOwnerKey, but
    // wrongOwnerPubkey.x does not match on-chain ownerX.
    const sig = Signature.create(wrongOwnerKey, [anotherNewOperator.x]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.transferOperator(anotherNewOperator, wrongOwnerPubkey, sig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  // =========================================================================
  // AC-4 + AC-5: applyProof after operator transfer
  // =========================================================================

  it('[P0] AC-4+5: should allow new operator to settle after transfer', async () => {
    // Build a second interact proof chaining from the first
    // Previous interactProof used CHECK(5) at ts=10000
    const prevCooldownArr = Array(ACTION_COUNT).fill(0);
    prevCooldownArr[ActionType.CHECK] = 10000;

    const result2 = await createInteractProof(
      interactProof,
      ActionType.CHECK, // use same action but at later timestamp
      20000,
      prevCooldownArr,
      Field(88888)
    );
    const secondInteractProof = result2.proof;
    const proofOutput = secondInteractProof.publicOutput;

    // New operator signs the lifecycleHash
    const newOperatorSig = Signature.create(newOperatorKey, [
      proofOutput.lifecycleHash,
    ]);

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(
        secondInteractProof,
        newOperatorPubkey,
        newOperatorSig
      );
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    expect(zkApp.brainHash.get()).toEqual(proofOutput.brainHash);
    expect(zkApp.lifecycleHash.get()).toEqual(proofOutput.lifecycleHash);
    expect(zkApp.cycle.get()).toEqual(proofOutput.cycle.value);

    // Save for later
    interactProof = secondInteractProof;
  });

  // =========================================================================
  // AC-2: Event emissions -- interaction event
  // =========================================================================

  it('[P1] AC-2: should emit interaction event on applyProof', async () => {
    const events = await zkApp.fetchEvents();
    const interactionEvents = events.filter(
      (e: { type: string }) => e.type === 'interaction'
    );
    // We've had: initializePet(1) + applyProof(1) + applyProof(2) = 3 interaction events minimum
    expect(interactionEvents.length).toBeGreaterThanOrEqual(3);
  });

  // =========================================================================
  // AC-2: Event emissions -- evolution event when stage changes
  // =========================================================================

  it('[P1] AC-2: should emit evolution event when stage changes via evolve proof', async () => {
    // Build a proof chain to reach cycle >= 7 for hatch (egg -> baby).
    // On-chain cycle is 3 (from previous tests). We chain 5 more interactions
    // off-chain (cycle 4..8), then evolve (cycle stays 8), and settle the
    // evolve proof directly. The evolve proof cycle (8) > on-chain cycle (3).
    // We do NOT settle the intermediate batch -- evolve doesn't increment cycle,
    // so settling batch then evolve would fail the cycle > on-chain check.
    let currentProof = interactProof;
    let currentCooldownArr = Array(ACTION_COUNT).fill(0) as number[];
    currentCooldownArr[ActionType.CHECK] = 20000; // from last interact

    let ts = 20000;

    // Chain 5 more interactions (cycle 4..8) using CHECK action
    for (let i = 0; i < 5; i++) {
      ts += 10000; // Advance timestamp beyond cooldown
      const result = await createInteractProof(
        currentProof,
        ActionType.CHECK,
        ts,
        currentCooldownArr,
        Field(200000 + i)
      );
      currentProof = result.proof;
      currentCooldownArr = result.cooldownArr;
    }

    // Evolve: egg -> baby (stage 0 -> 1) -- chains from interaction proof
    const evolveStats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const evolveResult = await PetLifecycle.evolve(
      currentProof,
      UInt32.from(1), // baby
      evolveStats
    );
    const evolveProof = evolveResult.proof;

    // Settle the evolve proof directly (cycle=8 > on-chain=3, stage=1 >= on-chain=0)
    const evolveSig = Signature.create(newOperatorKey, [
      evolveProof.publicOutput.lifecycleHash,
    ]);

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(evolveProof, newOperatorPubkey, evolveSig);
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    // Verify stage is now 1 (baby)
    expect(zkApp.stage.get()).toEqual(Field(1));

    // Check evolution event was emitted with non-zero value
    const events = await zkApp.fetchEvents();
    const evolutionEvents = events.filter(
      (e: { type: string }) => e.type === 'evolution'
    );
    // Find a non-zero evolution event (stage=1)
    const realEvolutions = evolutionEvents.filter((e) => {
      const val = (e.event as unknown as { data: Field }).data;
      return val.toString() !== '0';
    });
    expect(realEvolutions.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // AC-2: Event emissions -- evolution event with Field(0) on non-evolving applyProof
  // =========================================================================

  it('[P1] AC-2: should emit evolution event with Field(0) when stage does not change (consumer filtering requirement)', async () => {
    // o1js circuits cannot conditionally emit events. applyProof always emits
    // an evolution event -- with Field(0) when stage didn't change. Consumers
    // must filter out Field(0) evolution events. This test documents that behavior.
    const events = await zkApp.fetchEvents();
    const evolutionEvents = events.filter(
      (e: { type: string }) => e.type === 'evolution'
    );
    // Find zero-value evolution events (emitted when stage didn't change)
    const zeroEvolutions = evolutionEvents.filter((e) => {
      const val = (e.event as unknown as { data: Field }).data;
      return val.toString() === '0';
    });
    // We've had multiple applyProof calls where stage stayed the same
    expect(zeroEvolutions.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // AC-2: Event emissions -- operator-transfer event
  // =========================================================================

  it('[P1] AC-2: should emit operator-transfer event on transferOperator', async () => {
    const events = await zkApp.fetchEvents();
    const transferEvents = events.filter(
      (e: { type: string }) => e.type === 'operator-transfer'
    );
    expect(transferEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Defense-in-depth: applyProof and transferOperator on uninitialized contract
// =============================================================================

describe('PetZkApp -- uninitialized contract guards', () => {
  let deployer: Mina.TestPublicKey;
  let zkAppKey: PrivateKey;
  let zkAppAddress: PublicKey;
  let zkApp: PetZkApp;

  beforeAll(async () => {
    // Compile already done in first describe block's beforeAll (same process)
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);
    [deployer] = Local.testAccounts;

    zkAppKey = PrivateKey.random();
    zkAppAddress = zkAppKey.toPublicKey();
    zkApp = new PetZkApp(zkAppAddress);

    // Deploy but do NOT initialize
    const tx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await tx.prove();
    await tx.sign([deployer.key, zkAppKey]).send();
  });

  it('[P1] should reject applyProof on uninitialized contract (petId == Field(0))', async () => {
    const brainHash = Field(12345);
    const genesisResult = await PetLifecycle.genesis(brainHash);
    const genesisProof = genesisResult.proof;

    const operatorKey = PrivateKey.random();
    const operatorPubkey = operatorKey.toPublicKey();
    const operatorSig = Signature.create(operatorKey, [
      genesisProof.publicOutput.lifecycleHash,
    ]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.applyProof(genesisProof, operatorPubkey, operatorSig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });

  it('[P1] should reject transferOperator on uninitialized contract (petId == Field(0))', async () => {
    const ownerKey = PrivateKey.random();
    const ownerPubkey = ownerKey.toPublicKey();
    const newOperator = PrivateKey.random().toPublicKey();
    const ownerSig = Signature.create(ownerKey, [newOperator.x]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await zkApp.transferOperator(newOperator, ownerPubkey, ownerSig);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });
});
