/**
 * PetToken + PetZkApp Integration Test
 *
 * Tests the full lifecycle: deploy both contracts, mint PET tokens to operator,
 * interact with pet, settle proof with token burn, verify on-chain state.
 *
 * Uses proofsEnabled: false for unit-speed iteration.
 *
 * Story 11.8 -- AC-4
 *
 * @module PetToken.integration.test
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

import { PetToken } from './PetToken';
import { PetZkApp } from './PetZkApp';
import { PetLifecycle, CooldownTimestamps } from './PetLifecycle';
import type { PetLifecycleProof } from './PetLifecycle';
import { PetStats, PetAction } from './structs';
import { ActionType, ACTION_COUNT } from './constants';

describe('PetToken + PetZkApp Integration (proofsEnabled: false)', () => {
  let deployer: Mina.TestPublicKey;

  // PetToken contract
  let tokenAppKey: PrivateKey;
  let tokenAppAddress: PublicKey;
  let petToken: PetToken;

  // PetZkApp contract
  let zkAppKey: PrivateKey;
  let zkAppAddress: PublicKey;
  let zkApp: PetZkApp;

  // Actors
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

  beforeAll(async () => {
    // Compile in order: PetToken first (PetZkApp references it), then PetLifecycle, then PetZkApp
    await PetToken.compile();
    await PetLifecycle.compile();
    await PetZkApp.compile();

    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);
    [deployer] = Local.testAccounts;

    tokenAppKey = PrivateKey.random();
    tokenAppAddress = tokenAppKey.toPublicKey();
    petToken = new PetToken(tokenAppAddress);

    zkAppKey = PrivateKey.random();
    zkAppAddress = zkAppKey.toPublicKey();
    zkApp = new PetZkApp(zkAppAddress);

    ownerKey = PrivateKey.random();
    ownerPubkey = ownerKey.toPublicKey();
    operatorKey = PrivateKey.random();
    operatorPubkey = operatorKey.toPublicKey();
  });

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

  // =========================================================================
  // AC-4: Deploy PetToken + PetZkApp on LocalBlockchain
  // =========================================================================

  it('[P0] AC-4: should deploy PetToken and PetZkApp contracts', async () => {
    // Deploy PetToken
    const tokenTx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await petToken.deploy();
    });
    await tokenTx.prove();
    await tokenTx.sign([deployer.key, tokenAppKey]).send();

    expect(petToken.totalAmountInCirculation.get()).toEqual(UInt64.zero);

    // Deploy PetZkApp
    const zkAppTx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await zkAppTx.prove();
    await zkAppTx.sign([deployer.key, zkAppKey]).send();

    expect(zkApp.petId.get()).toEqual(Field(0));
  });

  // =========================================================================
  // AC-4: Mint PET tokens to operator's token account
  // =========================================================================

  it('[P0] AC-4: should mint PET tokens to operator token account', async () => {
    const mintAmount = UInt64.from(1000);

    // Admin signature from tokenAppKey
    const adminSignature = Signature.create(tokenAppKey, [
      ...mintAmount.toFields(),
      ...operatorPubkey.toFields(),
    ]);

    const tx = await Mina.transaction(deployer, async () => {
      // Fund operator's token account (first time receiving PET tokens)
      AccountUpdate.fundNewAccount(deployer);
      await petToken.mint(operatorPubkey, mintAmount, adminSignature);
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    // Verify operator's PET token balance
    const operatorBalance = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    expect(operatorBalance).toEqual(mintAmount);
    expect(petToken.totalAmountInCirculation.get()).toEqual(mintAmount);
  });

  // =========================================================================
  // AC-4: Initialize pet via initializePet with genesis proof
  // =========================================================================

  it('[P0] AC-4: should initialize pet with genesis proof', async () => {
    const genesisResult = await PetLifecycle.genesis(brainHash);
    genesisProof = genesisResult.proof;

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
    expect(zkApp.totalSpent.get()).toEqual(Field(0));
  });

  // =========================================================================
  // AC-4: Interact with Egg-compatible shop item (non-zero tokenCost) + applyProof with burn
  // =========================================================================

  it('[P0] AC-4: should burn PET tokens from operator during applyProof with shop item interaction', async () => {
    // Use med_bandage: actionType=8 (MEDICINE), itemId=11, tokenCost=20
    // MEDICINE is allowed for Egg stage per STAGE_ALLOWED_ACTIONS
    const action = new PetAction({
      actionType: UInt32.from(ActionType.MEDICINE),
      itemId: UInt32.from(11), // med_bandage
      timestamp: UInt64.from(10000),
      tokenCost: UInt64.from(20),
    });

    const stats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const zeroCDs = Array(ACTION_COUNT).fill(0) as number[];
    const prevCDs = cooldownsFromArray(zeroCDs);
    const newCDs = prevCDs.setByIndex(
      UInt32.from(ActionType.MEDICINE),
      UInt64.from(10000)
    );

    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerSig = Signature.create(ownerKey, [interactionHash]);

    const interactResult = await PetLifecycle.interact(
      genesisProof,
      action,
      stats,
      Field(99999),
      prevCDs,
      newCDs,
      ownerPubkey,
      ownerSig,
      UInt64.from(10000)
    );
    const interactProof = interactResult.proof;
    const proofOutput = interactProof.publicOutput;

    // Operator signs the new lifecycleHash
    const operatorSig = Signature.create(operatorKey, [
      proofOutput.lifecycleHash,
    ]);

    // Record balances before
    const operatorBalanceBefore = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    const circulationBefore = petToken.totalAmountInCirculation.get();

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(
        interactProof,
        operatorPubkey,
        operatorSig,
        tokenAppAddress
      );
    });
    await tx.prove();
    await tx.sign([deployer.key, operatorKey]).send();

    // Verify PET tokens burned from operator's token account
    const operatorBalanceAfter = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    const expectedBurn = UInt64.from(20); // tokenCost of med_bandage
    expect(operatorBalanceAfter).toEqual(
      operatorBalanceBefore.sub(expectedBurn)
    );

    // Verify totalAmountInCirculation decremented
    expect(petToken.totalAmountInCirculation.get()).toEqual(
      circulationBefore.sub(expectedBurn)
    );

    // Verify totalSpent on-chain matches proof output
    expect(zkApp.totalSpent.get()).toEqual(proofOutput.totalSpent.value);
  });

  // =========================================================================
  // AC-4: Second non-zero burn with accumulated totalSpent (delta calculation)
  // =========================================================================

  it('[P1] AC-4: should correctly compute burn delta when on-chain totalSpent is already non-zero', async () => {
    // After previous test, on-chain totalSpent=20 (from med_bandage burn).
    // Use hyg_soap: actionType=2 (CLEAN), itemId=15, tokenCost=15
    // CLEAN is allowed for Egg stage per STAGE_ALLOWED_ACTIONS.
    // Expected burn delta: proof.totalSpent(35) - onChain.totalSpent(20) = 15.

    // Re-create the previous interact proof to chain from it
    const prevAction = new PetAction({
      actionType: UInt32.from(ActionType.MEDICINE),
      itemId: UInt32.from(11),
      timestamp: UInt64.from(10000),
      tokenCost: UInt64.from(20),
    });
    const prevInteractionHash = Poseidon.hash([
      prevAction.actionType.value,
      prevAction.itemId.value,
      prevAction.timestamp.value,
      prevAction.tokenCost.value,
    ]);
    const prevOwnerSig = Signature.create(ownerKey, [prevInteractionHash]);
    const zeroCDs = cooldownsFromArray(Array(ACTION_COUNT).fill(0) as number[]);
    const prevNewCDs = zeroCDs.setByIndex(
      UInt32.from(ActionType.MEDICINE),
      UInt64.from(10000)
    );

    const prevInteractResult = await PetLifecycle.interact(
      genesisProof,
      prevAction,
      new PetStats({
        hunger: UInt32.from(100),
        happiness: UInt32.from(100),
        health: UInt32.from(100),
        hygiene: UInt32.from(100),
        energy: UInt32.from(100),
      }),
      Field(99999),
      zeroCDs,
      prevNewCDs,
      ownerPubkey,
      prevOwnerSig,
      UInt64.from(10000)
    );
    const prevProof = prevInteractResult.proof;

    // Now chain a second shop item interaction: hyg_soap (CLEAN, itemId=15, cost=15)
    const action = new PetAction({
      actionType: UInt32.from(ActionType.CLEAN),
      itemId: UInt32.from(15), // hyg_soap
      timestamp: UInt64.from(20000),
      tokenCost: UInt64.from(15),
    });

    const stats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    // Previous cooldowns: MEDICINE was used at ts=10000
    const prevCooldownArr = Array(ACTION_COUNT).fill(0) as number[];
    prevCooldownArr[ActionType.MEDICINE] = 10000;
    const prevCDs = cooldownsFromArray(prevCooldownArr);
    const newCDs = prevCDs.setByIndex(
      UInt32.from(ActionType.CLEAN),
      UInt64.from(20000)
    );

    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerSig = Signature.create(ownerKey, [interactionHash]);

    const interactResult = await PetLifecycle.interact(
      prevProof,
      action,
      stats,
      Field(77777),
      prevCDs,
      newCDs,
      ownerPubkey,
      ownerSig,
      UInt64.from(20000)
    );
    const interactProof = interactResult.proof;
    const proofOutput = interactProof.publicOutput;

    const operatorSig = Signature.create(operatorKey, [
      proofOutput.lifecycleHash,
    ]);

    // Record balances before second burn
    const operatorBalanceBefore = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    const circulationBefore = petToken.totalAmountInCirculation.get();

    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(
        interactProof,
        operatorPubkey,
        operatorSig,
        tokenAppAddress
      );
    });
    await tx.prove();
    await tx.sign([deployer.key, operatorKey]).send();

    // Verify burn delta is 15 (not 35) -- the delta between proof totalSpent and on-chain totalSpent
    const expectedBurnDelta = UInt64.from(15); // 35 - 20 = 15
    const operatorBalanceAfter = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    expect(operatorBalanceAfter).toEqual(
      operatorBalanceBefore.sub(expectedBurnDelta)
    );

    // Verify totalAmountInCirculation decremented by delta (not cumulative)
    expect(petToken.totalAmountInCirculation.get()).toEqual(
      circulationBefore.sub(expectedBurnDelta)
    );

    // Verify on-chain totalSpent is now 35 (cumulative: 20 + 15)
    expect(zkApp.totalSpent.get()).toEqual(proofOutput.totalSpent.value);
  });

  // =========================================================================
  // AC-4: Base action path (tokenCost=0) -- zero-amount burn is no-op
  // =========================================================================

  it('[P0] AC-4: should execute zero-amount burn without error for base action (tokenCost=0)', async () => {
    // After the previous two applyProof calls, on-chain cycle=3 and totalSpent=35.
    // We need a proof chain with cycle > 3. Build: genesis -> MEDICINE -> CLEAN -> CHECK
    // (4 steps = cycle 4). The CHECK base action has tokenCost=0, so proof totalSpent
    // stays at 35, matching on-chain -- burn delta = 0.

    const defaultStats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    // Step 1: genesis -> MEDICINE (cycle=2, totalSpent=20)
    const medAction = new PetAction({
      actionType: UInt32.from(ActionType.MEDICINE),
      itemId: UInt32.from(11),
      timestamp: UInt64.from(10000),
      tokenCost: UInt64.from(20),
    });
    const medHash = Poseidon.hash([
      medAction.actionType.value,
      medAction.itemId.value,
      medAction.timestamp.value,
      medAction.tokenCost.value,
    ]);
    const medOwnerSig = Signature.create(ownerKey, [medHash]);
    const zeroCDs = cooldownsFromArray(Array(ACTION_COUNT).fill(0) as number[]);
    const medNewCDs = zeroCDs.setByIndex(
      UInt32.from(ActionType.MEDICINE),
      UInt64.from(10000)
    );

    const medResult = await PetLifecycle.interact(
      genesisProof,
      medAction,
      defaultStats,
      Field(99999),
      zeroCDs,
      medNewCDs,
      ownerPubkey,
      medOwnerSig,
      UInt64.from(10000)
    );

    // Step 2: MEDICINE -> CLEAN/soap (cycle=3, totalSpent=35)
    const cleanAction = new PetAction({
      actionType: UInt32.from(ActionType.CLEAN),
      itemId: UInt32.from(15), // hyg_soap
      timestamp: UInt64.from(20000),
      tokenCost: UInt64.from(15),
    });
    const cleanHash = Poseidon.hash([
      cleanAction.actionType.value,
      cleanAction.itemId.value,
      cleanAction.timestamp.value,
      cleanAction.tokenCost.value,
    ]);
    const cleanOwnerSig = Signature.create(ownerKey, [cleanHash]);
    const medCooldownArr = Array(ACTION_COUNT).fill(0) as number[];
    medCooldownArr[ActionType.MEDICINE] = 10000;
    const medCDs = cooldownsFromArray(medCooldownArr);
    const cleanNewCDs = medCDs.setByIndex(
      UInt32.from(ActionType.CLEAN),
      UInt64.from(20000)
    );

    const cleanResult = await PetLifecycle.interact(
      medResult.proof,
      cleanAction,
      defaultStats,
      Field(77777),
      medCDs,
      cleanNewCDs,
      ownerPubkey,
      cleanOwnerSig,
      UInt64.from(20000)
    );

    // Step 3: CLEAN -> CHECK base action (cycle=4, totalSpent=35 -- no cost)
    const checkAction = new PetAction({
      actionType: UInt32.from(ActionType.CHECK),
      itemId: UInt32.from(0), // base action, tokenCost=0
      timestamp: UInt64.from(30000),
      tokenCost: UInt64.from(0),
    });
    const checkHash = Poseidon.hash([
      checkAction.actionType.value,
      checkAction.itemId.value,
      checkAction.timestamp.value,
      checkAction.tokenCost.value,
    ]);
    const checkOwnerSig = Signature.create(ownerKey, [checkHash]);
    const cleanCooldownArr = [...medCooldownArr];
    cleanCooldownArr[ActionType.CLEAN] = 20000;
    const cleanCDs = cooldownsFromArray(cleanCooldownArr);
    const checkNewCDs = cleanCDs.setByIndex(
      UInt32.from(ActionType.CHECK),
      UInt64.from(30000)
    );

    const checkResult = await PetLifecycle.interact(
      cleanResult.proof,
      checkAction,
      defaultStats,
      Field(88888),
      cleanCDs,
      checkNewCDs,
      ownerPubkey,
      checkOwnerSig,
      UInt64.from(30000)
    );
    const interactProof = checkResult.proof;
    const proofOutput = interactProof.publicOutput;

    const operatorSig = Signature.create(operatorKey, [
      proofOutput.lifecycleHash,
    ]);

    // Record balances before
    const operatorBalanceBefore = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );

    // applyProof with petTokenAddress -- zero burn should be no-op
    const tx = await Mina.transaction(deployer, async () => {
      await zkApp.applyProof(
        interactProof,
        operatorPubkey,
        operatorSig,
        tokenAppAddress
      );
    });
    await tx.prove();
    await tx.sign([deployer.key, operatorKey]).send();

    // Verify operator balance unchanged (zero burn delta)
    const operatorBalanceAfter = Mina.getBalance(
      operatorPubkey,
      petToken.deriveTokenId()
    );
    expect(operatorBalanceAfter).toEqual(operatorBalanceBefore);

    // Verify totalSpent on-chain matches proof output
    expect(zkApp.totalSpent.get()).toEqual(proofOutput.totalSpent.value);
  });

  // =========================================================================
  // AC-4: Insufficient PET balance scenario -- expect TX revert
  // =========================================================================

  it('[P0] AC-4: should revert when operator has insufficient PET balance for burn', async () => {
    // Create a new operator with zero PET balance (no minting)
    const poorOperatorKey = PrivateKey.random();
    const poorOperatorPubkey = poorOperatorKey.toPublicKey();

    // Deploy a fresh PetZkApp for this test
    const freshZkAppKey = PrivateKey.random();
    const freshZkAppAddress = freshZkAppKey.toPublicKey();
    const freshZkApp = new PetZkApp(freshZkAppAddress);

    const deployTx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await freshZkApp.deploy();
    });
    await deployTx.prove();
    await deployTx.sign([deployer.key, freshZkAppKey]).send();

    // Initialize with poorOperator
    const freshGenesis = await PetLifecycle.genesis(Field(77777));
    const freshGenesisProof = freshGenesis.proof;

    const initTx = await Mina.transaction(deployer, async () => {
      await freshZkApp.initializePet(
        ownerPubkey,
        poorOperatorPubkey,
        Field(99),
        Field(8),
        freshGenesisProof
      );
    });
    await initTx.prove();
    await initTx.sign([deployer.key]).send();

    // poorOperator has no token account -- the burn should fail

    // Create interaction with non-zero tokenCost
    const action = new PetAction({
      actionType: UInt32.from(ActionType.MEDICINE),
      itemId: UInt32.from(11), // med_bandage, tokenCost=20
      timestamp: UInt64.from(10000),
      tokenCost: UInt64.from(20),
    });

    const stats = new PetStats({
      hunger: UInt32.from(100),
      happiness: UInt32.from(100),
      health: UInt32.from(100),
      hygiene: UInt32.from(100),
      energy: UInt32.from(100),
    });

    const zeroCDs = cooldownsFromArray(Array(ACTION_COUNT).fill(0) as number[]);
    const newCDs = zeroCDs.setByIndex(
      UInt32.from(ActionType.MEDICINE),
      UInt64.from(10000)
    );

    const interactionHash = Poseidon.hash([
      action.actionType.value,
      action.itemId.value,
      action.timestamp.value,
      action.tokenCost.value,
    ]);
    const ownerSig = Signature.create(ownerKey, [interactionHash]);

    const interactResult = await PetLifecycle.interact(
      freshGenesisProof,
      action,
      stats,
      Field(55555),
      zeroCDs,
      newCDs,
      ownerPubkey,
      ownerSig,
      UInt64.from(10000)
    );
    const interactProof = interactResult.proof;
    const proofOutput = interactProof.publicOutput;

    const operatorSig = Signature.create(poorOperatorKey, [
      proofOutput.lifecycleHash,
    ]);

    // poorOperator has no PET tokens -- TX should revert
    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await freshZkApp.applyProof(
          interactProof,
          poorOperatorPubkey,
          operatorSig,
          tokenAppAddress
        );
      });
      await tx.prove();
      await tx.sign([deployer.key, poorOperatorKey]).send();
    }).rejects.toThrow();
  });
});
