/**
 * PetToken -- Custom Mina Token Contract for PET Economy
 *
 * Extends o1js `TokenContract` to implement a custom PET token that
 * PetZkApp burns during proof settlement. Every pet interaction with
 * a shop item has an on-chain economic cost enforced by the ZK circuit.
 *
 * Token operations:
 * - mint: Admin-authorized minting with signature verification
 * - burn: Decrement token supply (callable by PetZkApp during settlement)
 * - approveBase: Zero-balance-change approval for transfers
 *
 * Story 11.8 -- Epic 11: TOON Pets
 *
 * @module PetToken
 */

import {
  TokenContract,
  AccountUpdateForest,
  type DeployArgs,
  State,
  state,
  method,
  PublicKey,
  UInt64,
  Signature,
} from 'o1js';

export class PetToken extends TokenContract {
  @state(UInt64) totalAmountInCirculation = State<UInt64>();

  override async deploy(args?: DeployArgs): Promise<void> {
    await super.deploy(args);
    this.account.tokenSymbol.set('PET');
  }

  @method override async init(): Promise<void> {
    super.init();
    this.totalAmountInCirculation.set(UInt64.zero);
  }

  /**
   * Approve token account updates with zero-balance-change constraint.
   * Required by TokenContract base class for transfer approval.
   */
  @method async approveBase(forest: AccountUpdateForest): Promise<void> {
    this.checkZeroBalanceChange(forest);
  }

  /**
   * Admin-authorized minting. The admin is the contract deployer (this.address).
   * Signature must cover [amount, receiverAddress] fields.
   *
   * @param receiverAddress - Address to receive newly minted tokens
   * @param amount - Number of tokens to mint
   * @param adminSignature - Signature from admin key over [amount, receiverAddress]
   */
  @method async mint(
    receiverAddress: PublicKey,
    amount: UInt64,
    adminSignature: Signature
  ): Promise<void> {
    // Verify admin signature over [amount, receiverAddress]
    adminSignature
      .verify(
        this.address,
        amount.toFields().concat(receiverAddress.toFields())
      )
      .assertTrue('invalid admin signature');

    const totalAmountInCirculation =
      this.totalAmountInCirculation.getAndRequireEquals();
    const newTotal = totalAmountInCirculation.add(amount);
    this.internal.mint({ address: receiverAddress, amount });
    this.totalAmountInCirculation.set(newTotal);
  }

  /**
   * Burn tokens from a given address. Decrements totalAmountInCirculation.
   * Called by PetZkApp during proof settlement to enforce economic cost.
   *
   * When amount is UInt64.zero, this is a valid no-op burn.
   *
   * @param burnerAddress - Address whose tokens are burned
   * @param amount - Number of tokens to burn
   */
  @method async burn(burnerAddress: PublicKey, amount: UInt64): Promise<void> {
    const totalAmountInCirculation =
      this.totalAmountInCirculation.getAndRequireEquals();
    const newTotal = totalAmountInCirculation.sub(amount);
    this.internal.burn({ address: burnerAddress, amount });
    this.totalAmountInCirculation.set(newTotal);
  }
}
