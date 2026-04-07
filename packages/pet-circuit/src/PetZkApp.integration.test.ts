/**
 * PetZkApp SmartContract -- Integration Test with Real Proofs
 *
 * Tests run with proofsEnabled: true -- both ZkProgram and SmartContract
 * compilation take 1-5 minutes each. Total test time: ~10 minutes.
 *
 * Compilation order matters:
 *   1. await PetLifecycle.compile() -- produces VK that PetZkApp needs
 *   2. await PetZkApp.compile() -- references PetLifecycleProof, needs VK
 *
 * Tagged @slow for CI filtering.
 *
 * Story 11.3 -- AC-8
 *
 * @module PetZkApp.integration.test
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
import { PetStats, PetAction } from './structs';
import { ActionType } from './constants';

// 10 minute timeout for ZkProgram + SmartContract compilation
jest.setTimeout(600000);

describe('PetZkApp Integration @slow (proofsEnabled: true)', () => {
  let deployer: Mina.TestPublicKey;
  let zkAppKey: PrivateKey;
  let zkAppAddress: PublicKey;
  let zkApp: PetZkApp;
  let ownerKey: PrivateKey;
  let ownerPubkey: PublicKey;
  let operatorKey: PrivateKey;
  let operatorPubkey: PublicKey;

  const seed = Field(42);
  const blobbiId = Field(7);
  const brainHash = Field(12345);

  beforeAll(async () => {
    // Step 1: Compile PetLifecycle ZkProgram FIRST (produces verification key)
    console.time('PetLifecycle.compile');
    await PetLifecycle.compile();
    console.timeEnd('PetLifecycle.compile');

    // Step 2: Compile PetZkApp SmartContract (needs PetLifecycle VK)
    console.time('PetZkApp.compile');
    await PetZkApp.compile();
    console.timeEnd('PetZkApp.compile');

    // Step 3: Set up LocalBlockchain with proofs enabled
    const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
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

  it('[P0] AC-8 @slow: should deploy, initialize with real genesis proof, interact, and verify on-chain state', async () => {
    // =====================================================================
    // Phase 1: Deploy PetZkApp
    // =====================================================================
    const deployTx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await deployTx.prove();
    await deployTx.sign([deployer.key, zkAppKey]).send();

    // Verify deployment: all fields should be Field(0)
    expect(zkApp.petId.get()).toEqual(Field(0));

    // =====================================================================
    // Phase 2: Generate real genesis proof and initialize pet
    // =====================================================================
    console.time('PetLifecycle.genesis (real proof)');
    const genesisResult = await PetLifecycle.genesis(brainHash);
    console.timeEnd('PetLifecycle.genesis (real proof)');
    const genesisProof = genesisResult.proof;
    const genesisOutput = genesisProof.publicOutput;

    const initTx = await Mina.transaction(deployer, async () => {
      await zkApp.initializePet(
        ownerPubkey,
        operatorPubkey,
        seed,
        blobbiId,
        genesisProof
      );
    });
    await initTx.prove();
    await initTx.sign([deployer.key]).send();

    // Verify initialization
    const expectedPetId = Poseidon.hash([ownerPubkey.x, seed, blobbiId]);
    expect(zkApp.petId.get()).toEqual(expectedPetId);
    expect(zkApp.brainHash.get()).toEqual(genesisOutput.brainHash);
    expect(zkApp.lifecycleHash.get()).toEqual(genesisOutput.lifecycleHash);
    expect(zkApp.cycle.get()).toEqual(genesisOutput.cycle.value);
    expect(zkApp.stage.get()).toEqual(genesisOutput.stage.value);
    expect(zkApp.ownerX.get()).toEqual(ownerPubkey.x);
    expect(zkApp.operatorX.get()).toEqual(operatorPubkey.x);
    expect(zkApp.totalSpent.get()).toEqual(genesisOutput.totalSpent.value);

    // =====================================================================
    // Phase 3: Generate real interact proof and apply it
    // =====================================================================
    const newBrainHash = Field(99999);

    // Build a valid action: check (actionType=5, allowed for egg stage)
    const action = new PetAction({
      actionType: UInt32.from(ActionType.CHECK),
      itemId: UInt32.from(0),
      timestamp: UInt64.from(10000),
      tokenCost: UInt64.from(0),
    });

    const newStats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const prevCooldowns = new CooldownTimestamps({
      ts0: UInt64.from(0),
      ts1: UInt64.from(0),
      ts2: UInt64.from(0),
      ts3: UInt64.from(0),
      ts4: UInt64.from(0),
      ts5: UInt64.from(0),
      ts6: UInt64.from(0),
      ts7: UInt64.from(0),
      ts8: UInt64.from(0),
      ts9: UInt64.from(0),
      ts10: UInt64.from(0),
    });

    const newCooldowns = prevCooldowns.setByIndex(
      UInt32.from(ActionType.CHECK),
      UInt64.from(10000)
    );

    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerSig = Signature.create(ownerKey, [interactionHash]);
    const currentSlotTime = UInt64.from(10000);

    console.time('PetLifecycle.interact (real proof)');
    const interactResult = await PetLifecycle.interact(
      genesisProof,
      action,
      newStats,
      newBrainHash,
      prevCooldowns,
      newCooldowns,
      ownerPubkey,
      ownerSig,
      currentSlotTime
    );
    console.timeEnd('PetLifecycle.interact (real proof)');
    const interactProof = interactResult.proof;
    const interactOutput = interactProof.publicOutput;

    // Operator signs the new lifecycleHash
    const operatorSig = Signature.create(operatorKey, [
      interactOutput.lifecycleHash,
    ]);

    const applyTx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(interactProof, operatorPubkey, operatorSig);
    });
    await applyTx.prove();
    await applyTx.sign([deployer.key]).send();

    // =====================================================================
    // Phase 4: Verify on-chain state matches proof output
    // =====================================================================
    expect(zkApp.brainHash.get()).toEqual(interactOutput.brainHash);
    expect(zkApp.lifecycleHash.get()).toEqual(interactOutput.lifecycleHash);
    expect(zkApp.cycle.get()).toEqual(interactOutput.cycle.value);
    expect(zkApp.stage.get()).toEqual(interactOutput.stage.value);
    expect(zkApp.totalSpent.get()).toEqual(interactOutput.totalSpent.value);

    // Immutable fields unchanged
    expect(zkApp.petId.get()).toEqual(expectedPetId);
    expect(zkApp.ownerX.get()).toEqual(ownerPubkey.x);
    expect(zkApp.operatorX.get()).toEqual(operatorPubkey.x);

    // =====================================================================
    // Phase 5: Verify event emissions (interaction events from init + apply)
    // =====================================================================
    const events = await zkApp.fetchEvents();
    const interactionEvents = events.filter(
      (e: { type: string }) => e.type === 'interaction'
    );
    // initializePet emits 1 interaction event, applyProof emits 1 more
    expect(interactionEvents.length).toBeGreaterThanOrEqual(2);
  });
});
