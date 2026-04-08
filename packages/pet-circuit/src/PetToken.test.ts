/**
 * PetToken Custom Token Contract Unit Tests (RED Phase -- ATDD)
 *
 * Tests PetToken on LocalBlockchain with proofsEnabled: false.
 * Sequential test structure: deploy -> mint -> transfer -> burn -> error cases.
 *
 * Story 11.8 -- AC-3
 *
 * TDD RED PHASE: These tests are written BEFORE implementation.
 * They will fail until PetToken.ts is created with the correct contract logic.
 *
 * @module PetToken.test
 */

import {
  Mina,
  PrivateKey,
  type PublicKey,
  AccountUpdate,
  UInt64,
  Signature,
} from 'o1js';

// RED PHASE: This import will fail until PetToken.ts is created
import { PetToken } from './PetToken';

describe('PetToken Custom Token Contract (Unit Tests -- proofsEnabled: false)', () => {
  let deployer: Mina.TestPublicKey;
  let tokenAppKey: PrivateKey;
  let tokenAppAddress: PublicKey;
  let petToken: PetToken;
  let receiverKey: PrivateKey;
  let receiverAddress: PublicKey;
  let receiver2Key: PrivateKey;
  let receiver2Address: PublicKey;

  beforeAll(async () => {
    // Compile PetToken (even with proofsEnabled: false, o1js v2.14.0+ requires it)
    await PetToken.compile();

    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);
    [deployer] = Local.testAccounts;

    tokenAppKey = PrivateKey.random();
    tokenAppAddress = tokenAppKey.toPublicKey();
    petToken = new PetToken(tokenAppAddress);

    receiverKey = PrivateKey.random();
    receiverAddress = receiverKey.toPublicKey();
    receiver2Key = PrivateKey.random();
    receiver2Address = receiver2Key.toPublicKey();
  });

  // =========================================================================
  // AC-3: Deploy PetToken contract on LocalBlockchain
  // =========================================================================

  it('[P0] AC-3: should deploy PetToken contract with token symbol PET and zero circulation', async () => {
    const tx = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await petToken.deploy();
    });
    await tx.prove();
    await tx.sign([deployer.key, tokenAppKey]).send();

    // Verify token symbol is PET
    const tokenSymbol = Mina.getAccount(tokenAppAddress).tokenSymbol;
    expect(tokenSymbol).toEqual('PET');

    // Verify totalAmountInCirculation is zero
    expect(petToken.totalAmountInCirculation.get()).toEqual(UInt64.zero);
  });

  // =========================================================================
  // AC-3: Admin mints tokens to a receiver
  // =========================================================================

  it('[P0] AC-3: should mint tokens to receiver with valid admin signature and update circulation', async () => {
    const mintAmount = UInt64.from(1000);

    // Admin signature: the tokenAppKey (deployer of the contract) signs over [amount, receiverAddress]
    const adminSignature = Signature.create(tokenAppKey, [
      ...mintAmount.toFields(),
      ...receiverAddress.toFields(),
    ]);

    const tx = await Mina.transaction(deployer, async () => {
      // Fund the receiver's token account (first time receiving custom tokens)
      AccountUpdate.fundNewAccount(deployer);
      await petToken.mint(receiverAddress, mintAmount, adminSignature);
    });
    await tx.prove();
    await tx.sign([deployer.key]).send();

    // Verify receiver's token balance
    const receiverBalance = Mina.getBalance(
      receiverAddress,
      petToken.deriveTokenId()
    );
    expect(receiverBalance).toEqual(mintAmount);

    // Verify totalAmountInCirculation updated
    expect(petToken.totalAmountInCirculation.get()).toEqual(mintAmount);
  });

  // =========================================================================
  // AC-3: Transfer tokens between accounts (net-zero forest)
  // =========================================================================

  it('[P0] AC-3: should transfer tokens between accounts using net-zero balance change forest', async () => {
    const transferAmount = UInt64.from(200);

    const tx = await Mina.transaction(deployer, async () => {
      // Fund receiver2's token account (first time receiving custom tokens)
      AccountUpdate.fundNewAccount(deployer);
      // Transfer from receiver to receiver2 using internal.send
      await petToken.transfer(
        receiverAddress,
        receiver2Address,
        transferAmount
      );
    });
    await tx.prove();
    await tx.sign([deployer.key, receiverKey]).send();

    // Verify receiver's balance decreased
    const receiverBalance = Mina.getBalance(
      receiverAddress,
      petToken.deriveTokenId()
    );
    expect(receiverBalance).toEqual(UInt64.from(800)); // 1000 - 200

    // Verify receiver2's balance increased
    const receiver2Balance = Mina.getBalance(
      receiver2Address,
      petToken.deriveTokenId()
    );
    expect(receiver2Balance).toEqual(transferAmount);

    // Verify totalAmountInCirculation unchanged (transfer is net-zero)
    expect(petToken.totalAmountInCirculation.get()).toEqual(UInt64.from(1000));
  });

  // =========================================================================
  // AC-3: Burn tokens (verify balance and circulation decremented)
  // =========================================================================

  it('[P0] AC-3: should burn tokens from account and decrement circulation', async () => {
    const burnAmount = UInt64.from(100);

    const tx = await Mina.transaction(deployer, async () => {
      await petToken.burn(receiverAddress, burnAmount);
    });
    await tx.prove();
    await tx.sign([deployer.key, receiverKey]).send();

    // Verify receiver's balance decreased
    const receiverBalance = Mina.getBalance(
      receiverAddress,
      petToken.deriveTokenId()
    );
    expect(receiverBalance).toEqual(UInt64.from(700)); // 800 - 100

    // Verify totalAmountInCirculation decremented
    expect(petToken.totalAmountInCirculation.get()).toEqual(UInt64.from(900)); // 1000 - 100
  });

  // =========================================================================
  // AC-3: Burn zero tokens (no-op behavior)
  // =========================================================================

  it('[P0] AC-3: should burn zero tokens without error (validates unconditional burn path in AC-2)', async () => {
    const zeroBurn = UInt64.from(0);
    const balanceBefore = Mina.getBalance(
      receiverAddress,
      petToken.deriveTokenId()
    );
    const circulationBefore = petToken.totalAmountInCirculation.get();

    const tx = await Mina.transaction(deployer, async () => {
      await petToken.burn(receiverAddress, zeroBurn);
    });
    await tx.prove();
    await tx.sign([deployer.key, receiverKey]).send();

    // Balance unchanged
    const balanceAfter = Mina.getBalance(
      receiverAddress,
      petToken.deriveTokenId()
    );
    expect(balanceAfter).toEqual(balanceBefore);

    // Circulation unchanged
    expect(petToken.totalAmountInCirculation.get()).toEqual(circulationBefore);
  });

  // =========================================================================
  // AC-3: Reject unauthorized mint (wrong signature)
  // =========================================================================

  it('[P0] AC-3: should reject mint with wrong admin signature', async () => {
    const mintAmount = UInt64.from(500);
    const wrongKey = PrivateKey.random();

    // Sign with wrong key (not the admin/tokenAppKey)
    const invalidSignature = Signature.create(wrongKey, [
      ...mintAmount.toFields(),
      ...receiverAddress.toFields(),
    ]);

    await expect(async () => {
      const tx = await Mina.transaction(deployer, async () => {
        await petToken.mint(receiverAddress, mintAmount, invalidSignature);
      });
      await tx.prove();
      await tx.sign([deployer.key]).send();
    }).rejects.toThrow();
  });
});
